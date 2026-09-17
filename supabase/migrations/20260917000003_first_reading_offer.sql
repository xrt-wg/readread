-- 首次阅读：默认关闭，正式两篇推荐须另行配置。
begin;

create table public.first_reading_config (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  submission_a text references public.recommendation_submissions(id),
  submission_b text references public.recommendation_submissions(id),
  updated_at timestamptz not null default now(),
  check (not enabled or (submission_a is not null and submission_b is not null and submission_a <> submission_b))
);
insert into public.first_reading_config(id) values (true);
alter table public.first_reading_config enable row level security;
revoke all on public.first_reading_config from anon, authenticated;

create table public.user_first_reading_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','chosen','dismissed','suppressed')),
  selected_submission_id text,
  selected_reading_id text,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_first_reading_states enable row level security;
revoke all on public.user_first_reading_states from anon, authenticated;
grant select on public.user_first_reading_states to authenticated;
create policy first_reading_state_own on public.user_first_reading_states for select to authenticated using (user_id = auth.uid());

-- All content writers (including direct imports and migration) participate.
create function public.lock_reading_user(p_user_id uuid) returns void
language sql security definer set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('readread:user:' || p_user_id::text, 0));
$$;

create function public.guard_reading_user_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if tg_op = 'DELETE' then v_user := old.user_id; else v_user := new.user_id; end if;
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    raise exception 'Cannot transfer reading data between accounts';
  end if;
  perform public.lock_reading_user(v_user);
  -- Account deletion cascades must not recreate a state row referencing the deleted account.
  if tg_op = 'DELETE' and not exists(select 1 from auth.users where id=v_user) then return old; end if;
  if tg_table_name = 'readings' and tg_op <> 'DELETE' then
    if new.reading_status = 'reading' and new.deleted_at is null then
      if (select count(*) from public.readings where user_id = v_user and reading_status = 'reading'
          and deleted_at is null and id <> new.id) >= 5 then
        raise exception '阅读区已满（上限 5 本），请先放回一本书';
      end if;
    end if;
  end if;
  insert into public.user_first_reading_states(user_id, status, handled_at)
    values (v_user, 'suppressed', now())
    on conflict (user_id) do update set status = 'suppressed', handled_at = now(), updated_at = now()
      where user_first_reading_states.status = 'pending';
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger first_reading_guard before insert or update or delete on public.readings
  for each row execute function public.guard_reading_user_write();
create trigger first_reading_guard before insert or update or delete on public.bookmarks
  for each row execute function public.guard_reading_user_write();
create trigger first_reading_guard before insert or update or delete on public.reading_marks
  for each row execute function public.guard_reading_user_write();

-- Historical usage, including soft-deleted rows, permanently suppresses the offer.
insert into public.user_first_reading_states(user_id,status,handled_at)
select user_id,'suppressed',now() from (
 select user_id from public.readings union select user_id from public.bookmarks union select user_id from public.reading_marks
) used on conflict do nothing;

create function public.first_reading_actor() returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null or not exists(select 1 from public.profiles where user_id=u and status='active') then
    raise exception '当前账号不可用' using errcode='42501';
  end if;
  perform public.lock_reading_user(u);
  insert into public.user_first_reading_states(user_id) values(u) on conflict do nothing;
  return u;
end;
$$;

-- Equivalent to assembleSections + deriveParentIds; reject malformed/empty content.
create function public.normalize_first_reading_sections(p_sections jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare s jsonb; result jsonb := '[]'; i integer := 0; j integer; d integer; parent text; body_text text; words integer; total integer := 0;
begin
  if jsonb_typeof(p_sections) is distinct from 'array' or jsonb_array_length(p_sections)=0 then return null; end if;
  for s in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(s->'body'->'text') is distinct from 'string' then return null; end if;
    body_text := s->'body'->>'text';
    d := coalesce((s->>'depth')::integer,0);
    parent := null;
    if i > 0 then
      for j in reverse i-1..0 loop
        if (result->j->>'depth')::integer < d then parent := result->j->>'id'; exit; end if;
      end loop;
    end if;
    select count(*) into words from regexp_split_to_table(body_text, E'\\s+') w where w <> '';
    total := total + words;
    result := result || jsonb_build_array(jsonb_build_object('id','s_'||i,'heading',s->'heading','depth',d,
      'order',coalesce((s->>'order')::integer,i),'parentId',parent,'body',jsonb_build_object('text',body_text,'markdown',s->'body'->'markdown','wordCount',words)));
    i := i+1;
  end loop;
  if total=0 then return null; end if;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end;
$$;

create function public.first_reading_cards() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.first_reading_config; sid text; rec record; normalized jsonb; result jsonb := '[]'; words integer;
begin
  select * into c from public.first_reading_config where id=true;
  if not found or not c.enabled then return '[]'; end if;
  foreach sid in array array[c.submission_a,c.submission_b] loop
    select s.id,s.intro,x.title,x.sections into rec from public.recommendation_submissions s
      join public.recommendation_submission_snapshots x on x.submission_id=s.id where s.id=sid and s.status='active';
    if not found then return '[]'; end if;
    normalized := public.normalize_first_reading_sections(rec.sections);
    if normalized is null then return '[]'; end if;
    select sum((value->'body'->>'wordCount')::integer) into words from jsonb_array_elements(normalized);
    result := result || jsonb_build_array(jsonb_build_object('id',sid,'title',rec.title,'intro',left(rec.intro,180),'wordCount',words));
  end loop;
  return result;
end;
$$;

create function public.get_first_reading_offer() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := public.first_reading_actor(); st public.user_first_reading_states;
begin
  select * into st from public.user_first_reading_states where user_id=u for update;
  if st.status='pending' and (exists(select 1 from public.readings where user_id=u)
    or exists(select 1 from public.bookmarks where user_id=u) or exists(select 1 from public.reading_marks where user_id=u)) then
    update public.user_first_reading_states set status='suppressed',handled_at=now(),updated_at=now() where user_id=u returning * into st;
  end if;
  return jsonb_build_object('status',st.status,'readingId',st.selected_reading_id,
    'items',case when st.status='pending' then public.first_reading_cards() else '[]'::jsonb end);
end;
$$;

create function public.dismiss_first_reading_offer() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := public.first_reading_actor(); st public.user_first_reading_states;
begin
  select * into st from public.user_first_reading_states where user_id=u for update;
  if st.status='pending' then
    update public.user_first_reading_states set status='dismissed',handled_at=now(),updated_at=now() where user_id=u returning * into st;
  end if;
  return jsonb_build_object('status',st.status,'readingId',st.selected_reading_id);
end;
$$;

create function public.choose_first_reading_offer(p_submission_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := public.first_reading_actor(); st public.user_first_reading_states; c public.first_reading_config;
  snap public.recommendation_submission_snapshots; sections jsonb; rid text; words integer;
begin
  select * into st from public.user_first_reading_states where user_id=u for update;
  if st.status <> 'pending' then return jsonb_build_object('status',st.status,'readingId',st.selected_reading_id); end if;
  if exists(select 1 from public.readings where user_id=u) or exists(select 1 from public.bookmarks where user_id=u)
    or exists(select 1 from public.reading_marks where user_id=u) then
    update public.user_first_reading_states set status='suppressed',handled_at=now(),updated_at=now() where user_id=u;
    return jsonb_build_object('status','suppressed');
  end if;
  select * into c from public.first_reading_config where id=true for share;
  if not c.enabled or p_submission_id is null or p_submission_id not in (c.submission_a,c.submission_b) then
    raise exception '选文内容暂不可用';
  end if;
  -- Deterministic order avoids competing A/B recommendation locks.
  perform 1 from public.recommendation_submissions where id in (c.submission_a,c.submission_b) order by id for update;
  if jsonb_array_length(public.first_reading_cards()) <> 2 then raise exception '选文内容暂不可用'; end if;
  select * into snap from public.recommendation_submission_snapshots where submission_id=p_submission_id;
  sections := public.normalize_first_reading_sections(snap.sections);
  select sum((value->'body'->>'wordCount')::integer) into words from jsonb_array_elements(sections);
  rid := 'rd_' || gen_random_uuid()::text;
  insert into public.readings(id,user_id,title,author,format,cover_url,lang,source_url,sections,total_word_count,section_count,
    kind,reading_status,reading_started_at,origin,share_status,share_source_id)
  values(rid,u,snap.title,snap.author,snap.format,snap.cover_url,snap.lang,snap.source_url,sections,words,jsonb_array_length(sections),
    case when snap.kind in ('article','book') then snap.kind when snap.format='epub' then 'book' else 'article' end,
    'reading',now(),'featured','private',p_submission_id);
  perform public.increment_recommendation_add_count(p_submission_id,u);
  update public.user_first_reading_states set status='chosen',selected_submission_id=p_submission_id,
    selected_reading_id=rid,handled_at=now(),updated_at=now() where user_id=u;
  return jsonb_build_object('status','chosen','readingId',rid);
end;
$$;

-- Lock BEFORE counting, including empty accounts. All write paths also use the trigger.
create or replace function public.increment_recommendation_add_count(p_submission_id text,p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'unauthenticated' using errcode='42501'; end if;
  perform 1 from public.recommendation_submissions where id=p_submission_id for update;
  select count(distinct user_id) into n from public.readings
    where share_source_id=p_submission_id and origin in ('featured','featured_legacy') and deleted_at is null;
  update public.recommendation_submissions set add_count=n,updated_at=now() where id=p_submission_id and status='active';
  update public.recommendation_submissions set recommend_score=public.compute_recommendation_score(p_submission_id)
    where id=p_submission_id and status='active';
end;
$$;

create or replace function public.start_reading(p_reading_id text,p_user_id uuid,p_max_limit integer default 5) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'unauthenticated' using errcode='42501'; end if;
  perform public.lock_reading_user(p_user_id);
  update public.readings set reading_status='reading',reading_started_at=coalesce(reading_started_at,now()),updated_at=now()
    where id=p_reading_id and user_id=p_user_id and deleted_at is null;
  if not found then raise exception '阅读内容不存在'; end if;
end;
$$;

revoke all on function public.lock_reading_user(uuid), public.guard_reading_user_write(), public.first_reading_actor(),
 public.normalize_first_reading_sections(jsonb), public.first_reading_cards(), public.get_first_reading_offer(),
 public.dismiss_first_reading_offer(), public.choose_first_reading_offer(text) from public, anon, authenticated;
grant execute on function public.get_first_reading_offer(),public.dismiss_first_reading_offer(),public.choose_first_reading_offer(text) to authenticated;
notify pgrst, 'reload schema';
commit;
