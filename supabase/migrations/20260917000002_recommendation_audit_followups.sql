-- 实施后审核修复：生命周期一致性、快照缺失降级与管理员详情。
begin;

update public.recommendation_submissions
set first_published_at = coalesce(first_published_at, created_at),
    published_at = coalesce(published_at, created_at)
where status = 'active' and (first_published_at is null or published_at is null);

create or replace function public.admin_list_recommendation_submissions()
returns jsonb language sql security definer set search_path = public as $$
  select case when public.is_current_user_admin() then coalesce(jsonb_agg(
    to_jsonb(s) || jsonb_build_object('internal_note', r.internal_note, 'snapshot_missing', x.submission_id is null)
    order by case s.status when 'pending' then 0 when 'approved' then 1 when 'removed' then 2 else 3 end, s.created_at asc
  ), '[]'::jsonb) else '[]'::jsonb end
  from public.recommendation_submissions s
  left join public.recommendation_submission_admin_reviews r on r.submission_id = s.id
  left join public.recommendation_submission_snapshots x on x.submission_id = s.id
$$;

create or replace function public.admin_get_recommendation_submission_detail(p_submission_id text)
returns jsonb language sql security definer set search_path = public as $$
  select case when public.is_current_user_admin() then jsonb_build_object(
    'submission', to_jsonb(s), 'internal_note', r.internal_note, 'reviewed_at', r.reviewed_at,
    'snapshot', case when x.submission_id is null then null else jsonb_build_object('content_hash', x.content_hash, 'sections', x.sections, 'created_at', x.created_at, 'title', x.title, 'author', x.author, 'source_url', x.source_url) end
  ) else null end
  from public.recommendation_submissions s
  left join public.recommendation_submission_admin_reviews r on r.submission_id = s.id
  left join public.recommendation_submission_snapshots x on x.submission_id = s.id
  where s.id = p_submission_id
$$;

create or replace function public.admin_approve_recommendation(p_submission_id text, p_internal_note text default null)
returns public.recommendation_submissions language plpgsql security definer set search_path = public as $$
declare v_result public.recommendation_submissions%rowtype; v_prior text;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  select status into v_prior from public.recommendation_submissions where id = p_submission_id;
  update public.recommendation_submissions set status = 'approved', approved_at = now(), rejection_reason = null, rejection_at = null, updated_at = now() where id = p_submission_id and status in ('pending', 'removed') returning * into v_result;
  if not found then raise exception '仅待审核或已下架内容可以通过审核'; end if;
  insert into public.recommendation_submission_admin_reviews (submission_id, internal_note, reviewed_by, reviewed_at, updated_at) values (p_submission_id, p_internal_note, auth.uid(), now(), now()) on conflict (submission_id) do update set internal_note=excluded.internal_note, reviewed_by=excluded.reviewed_by, reviewed_at=excluded.reviewed_at, updated_at=excluded.updated_at;
  insert into public.audit_logs (actor_user_id, actor_role, action, target_type, target_id) values (auth.uid(), 'admin', case when v_prior='removed' then 'recommendation.reopened' else 'recommendation.approved' end, 'recommendation_submission', p_submission_id);
  return v_result;
end; $$;

create or replace function public.admin_publish_recommendation(p_submission_id text, p_internal_note text default null)
returns public.recommendation_submissions language plpgsql security definer set search_path = public as $$
declare v_result public.recommendation_submissions%rowtype;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  update public.recommendation_submissions set status='active', first_published_at=coalesce(first_published_at, now()), published_at=now(), removal_reason=null, removed_at=null, updated_at=now() where id=p_submission_id and status='approved' and length(trim(intro)) > 0 and cardinality(excerpts) between 1 and 5 returning * into v_result;
  if not found then raise exception '发布前需处于已通过状态，并填写推荐语及 1 至 5 条摘录'; end if;
  insert into public.recommendation_submission_admin_reviews (submission_id, internal_note, reviewed_by, reviewed_at, updated_at) values (p_submission_id,p_internal_note,auth.uid(),now(),now()) on conflict (submission_id) do update set internal_note=excluded.internal_note, reviewed_by=excluded.reviewed_by, reviewed_at=excluded.reviewed_at, updated_at=excluded.updated_at;
  insert into public.audit_logs (actor_user_id, actor_role, action, target_type, target_id) values (auth.uid(),'admin','recommendation.published','recommendation_submission',p_submission_id); return v_result;
end; $$;

grant execute on function public.admin_get_recommendation_submission_detail(text) to authenticated;
notify pgrst, 'reload schema';
commit;
