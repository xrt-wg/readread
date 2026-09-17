begin;

create function public.admin_get_first_reading_config() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.first_reading_config; candidates jsonb;
begin
  if auth.uid() is null or not public.is_current_user_admin()
    or not exists(select 1 from public.profiles where user_id=auth.uid() and status='active') then
    raise exception '无管理员权限' using errcode='42501';
  end if;
  select * into c from public.first_reading_config where id=true;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',coalesce(x.title,s.id),
      'intro',left(s.intro,180),'status',s.status,'available',s.status='active' and n.sections is not null,
      'wordCount',coalesce((select sum((v->'body'->>'wordCount')::integer) from jsonb_array_elements(n.sections) v),0))
      order by s.updated_at desc nulls last,s.id),'[]'::jsonb)
    into candidates
    from public.recommendation_submissions s
    left join public.recommendation_submission_snapshots x on x.submission_id=s.id
    left join lateral (select public.normalize_first_reading_sections(x.sections) sections) n on true
    where s.status='active' or s.id in(c.submission_a,c.submission_b);
  return jsonb_build_object('enabled',c.enabled,'submissionA',c.submission_a,'submissionB',c.submission_b,
    'updatedAt',c.updated_at,'items',candidates);
end;
$$;

create function public.admin_save_first_reading_config(p_submission_a text,p_submission_b text,p_enabled boolean,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.first_reading_config; sid text; valid_count integer;
begin
  if auth.uid() is null or not public.is_current_user_admin()
    or not exists(select 1 from public.profiles where user_id=auth.uid() and status='active') then
    raise exception '无管理员权限' using errcode='42501';
  end if;
  select * into c from public.first_reading_config where id=true for update;
  if p_expected_updated_at is null or c.updated_at is distinct from p_expected_updated_at then
    raise exception '配置已被其他管理员修改，请重新加载后再保存';
  end if;
  if p_enabled is null then raise exception '请选择启用状态'; end if;
  if p_submission_a is not null and p_submission_a=p_submission_b then raise exception '请选择两篇不同的文章'; end if;
  perform 1 from public.recommendation_submissions where id in(p_submission_a,p_submission_b) order by id for share;
  -- Drafts can preserve a previously selected, now unavailable item so disabling never gets blocked.
  foreach sid in array array[p_submission_a,p_submission_b] loop
    if sid is not null and not exists(select 1 from public.recommendation_submissions where id=sid and status='active')
      and sid is distinct from c.submission_a and sid is distinct from c.submission_b then
      raise exception '只能选择已发布的推荐内容';
    end if;
  end loop;
  if p_enabled then
    select count(*) into valid_count from public.recommendation_submissions s
      join public.recommendation_submission_snapshots x on x.submission_id=s.id
      where s.id in(p_submission_a,p_submission_b) and s.status='active'
        and public.normalize_first_reading_sections(x.sections) is not null;
    if valid_count<>2 then raise exception '启用前请选择两篇已发布且正文可用的文章'; end if;
  end if;
  update public.first_reading_config set submission_a=p_submission_a,submission_b=p_submission_b,
    enabled=p_enabled,updated_at=clock_timestamp() where id=true;
  insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,payload)
    values(auth.uid(),'admin','first_reading.config_updated','first_reading_config','true',
      jsonb_build_object('before',to_jsonb(c),'after',jsonb_build_object('submission_a',p_submission_a,'submission_b',p_submission_b,'enabled',p_enabled)));
  return public.admin_get_first_reading_config();
end;
$$;

revoke all on function public.admin_get_first_reading_config(),public.admin_save_first_reading_config(text,text,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_get_first_reading_config(),public.admin_save_first_reading_config(text,text,boolean,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
