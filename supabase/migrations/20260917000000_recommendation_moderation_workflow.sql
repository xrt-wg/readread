-- 推荐提交审核发布：提交申请、私有快照、人工审核与分离发布
begin;

create extension if not exists pgcrypto;

-- 1. 主表只保留提交者或公众可见字段。
alter table public.recommendation_submissions
  drop constraint if exists recommendation_submissions_status_check,
  drop constraint if exists recommendation_submissions_intro_check,
  drop constraint if exists recommendation_submissions_excerpts_check;

alter table public.recommendation_submissions
  add column if not exists rejection_reason text,
  add column if not exists rejection_at timestamptz,
  add column if not exists removal_reason text,
  add column if not exists removed_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists first_published_at timestamptz,
  add column if not exists published_at timestamptz;

alter table public.recommendation_submissions
  add constraint recommendation_submissions_status_check
  check (status in ('pending', 'approved', 'active', 'rejected', 'removed')),
  add constraint recommendation_submissions_active_content_check
  check (
    status <> 'active'
    or (length(trim(intro)) > 0 and cardinality(excerpts) between 1 and 5)
  );

-- 2. 提交正文和去重信息为私有快照，避免原书架内容变更影响审核。
create table if not exists public.recommendation_submission_snapshots (
  submission_id text primary key references public.recommendation_submissions(id) on delete cascade,
  source_reading_id text not null,
  title text not null,
  author text,
  source_url text,
  normalized_source_url text,
  sections jsonb not null,
  content_hash text not null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.recommendation_submission_snapshots
  add column if not exists format text not null default 'markdown',
  add column if not exists cover_url text,
  add column if not exists lang text not null default 'auto',
  add column if not exists kind text not null default 'article';

create unique index if not exists idx_rec_snapshot_content_hash
  on public.recommendation_submission_snapshots (content_hash);
create unique index if not exists idx_rec_snapshot_normalized_source_url
  on public.recommendation_submission_snapshots (normalized_source_url)
  where normalized_source_url is not null;

-- 为既有推荐补建快照；同内容的历史重复项保留可加入书架能力，但只让首条承担去重键。
with source_rows as (
  select s.id, s.reading_id, s.title, s.author, s.source_url, r.sections, r.format, r.cover_url, r.lang, r.kind,
    encode(extensions.digest(regexp_replace(lower(r.sections::text), '\s+', ' ', 'g'), 'sha256'), 'hex') as base_hash,
    nullif(regexp_replace(regexp_replace(lower(trim(s.source_url)), '(#.*$|([?&])(utm_[^=&]+|fbclid|gclid)=[^&]*&?)', '', 'g'), '/$', ''), '') as normalized_url
  from public.recommendation_submissions s
  join public.readings r on r.id = s.reading_id
), ranked_rows as (
  select *, row_number() over (partition by base_hash order by id) as hash_rank,
    row_number() over (partition by normalized_url order by id) as url_rank
  from source_rows
)
insert into public.recommendation_submission_snapshots
  (submission_id, source_reading_id, title, author, source_url, normalized_source_url, sections, content_hash, format, cover_url, lang, kind)
select id, reading_id, title, author, source_url,
  case when normalized_url is not null and url_rank = 1 then normalized_url else null end,
  sections, case when hash_rank = 1 then base_hash else base_hash || ':' || id end,
  format, cover_url, lang, kind
from ranked_rows
on conflict (submission_id) do nothing;

-- 3. 管理员专用数据与公开主表隔离，RLS 不再承担列级保密责任。
create table if not exists public.recommendation_submission_admin_reviews (
  submission_id text primary key references public.recommendation_submissions(id) on delete cascade,
  internal_note text,
  reviewed_by uuid references public.profiles(user_id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.recommendation_submission_snapshots enable row level security;
alter table public.recommendation_submission_admin_reviews enable row level security;
grant select on public.recommendation_submission_snapshots to authenticated;
grant select on public.recommendation_submission_admin_reviews to authenticated;

drop policy if exists "recommendation_snapshots_select_own" on public.recommendation_submission_snapshots;
create policy "recommendation_snapshots_select_own"
  on public.recommendation_submission_snapshots for select to authenticated
  using (exists (
    select 1 from public.recommendation_submissions s
    where s.id = submission_id and s.submitter_user_id = auth.uid()
  ));
drop policy if exists "recommendation_snapshots_select_admin" on public.recommendation_submission_snapshots;
create policy "recommendation_snapshots_select_admin"
  on public.recommendation_submission_snapshots for select to authenticated
  using (public.is_current_user_admin());
drop policy if exists "recommendation_reviews_select_admin" on public.recommendation_submission_admin_reviews;
create policy "recommendation_reviews_select_admin"
  on public.recommendation_submission_admin_reviews for select to authenticated
  using (public.is_current_user_admin());

drop policy if exists "Users can insert submissions" on public.recommendation_submissions;
drop policy if exists "Users can update own submissions" on public.recommendation_submissions;
drop policy if exists "recommendation_submissions_select_admin" on public.recommendation_submissions;
create policy "recommendation_submissions_select_admin"
  on public.recommendation_submissions for select to authenticated
  using (public.is_current_user_admin());
revoke insert, update on public.recommendation_submissions from authenticated;

-- URL 标准化：保留语义查询参数，去掉 fragment、常见追踪参数和尾部斜杠。
create or replace function public.normalize_recommendation_source_url(p_url text)
returns text language sql immutable as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(trim(p_url)), '(#.*$|([?&])(utm_[^=&]+|fbclid|gclid)=[^&]*&?)', '', 'g'),
      '/$', ''
    ), ''
  )
$$;

-- 用户提交：所有资格、去重、快照和审计在同一事务内完成。
create or replace function public.submit_recommendation_for_review(
  p_reading_id text,
  p_title text default null,
  p_author text default null,
  p_source_url text default null
)
returns public.recommendation_submissions
language plpgsql security definer set search_path = public as $$
declare
  v_reading public.readings%rowtype;
  v_id text := 'rec_' || replace(gen_random_uuid()::text, '-', '');
  v_title text;
  v_author text;
  v_source_url text;
  v_normalized_url text;
  v_hash text;
  v_result public.recommendation_submissions%rowtype;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  select * into v_reading from public.readings
    where id = p_reading_id and user_id = auth.uid() and deleted_at is null;
  if not found then raise exception '素材不存在或无权提交'; end if;
  if v_reading.origin <> 'imported' then raise exception '仅自导入内容可提交推荐'; end if;
  if not exists (select 1 from public.reading_marks where reading_id = p_reading_id and user_id = auth.uid() and completed) then
    raise exception '请先完成阅读后再提交推荐';
  end if;
  if (select count(*) from public.recommendation_submissions where submitter_user_id = auth.uid() and created_at >= now() - interval '7 days') >= 1 then
    raise exception '本周已提交 1 篇推荐，请下周再试';
  end if;

  v_title := coalesce(nullif(trim(p_title), ''), v_reading.title);
  v_author := coalesce(nullif(trim(p_author), ''), v_reading.author);
  v_source_url := coalesce(nullif(trim(p_source_url), ''), v_reading.source_url);
  v_normalized_url := public.normalize_recommendation_source_url(v_source_url);
  v_hash := encode(extensions.digest(regexp_replace(lower(v_reading.sections::text), '\s+', ' ', 'g'), 'sha256'), 'hex');

  if exists (
    select 1 from public.recommendation_submission_snapshots
    where content_hash = v_hash
       or (v_normalized_url is not null and normalized_source_url = v_normalized_url)
  ) then raise exception '该内容已提交推荐，不能重复提交'; end if;

  insert into public.recommendation_submissions (id, submitter_user_id, reading_id, title, author, source_url, intro, keywords, excerpts, status)
  values (v_id, auth.uid(), p_reading_id, v_title, v_author, v_source_url, '', '{}', '{}', 'pending')
  returning * into v_result;
  insert into public.recommendation_submission_snapshots
    (submission_id, source_reading_id, title, author, source_url, normalized_source_url, sections, content_hash, format, cover_url, lang, kind)
  values (v_id, p_reading_id, v_title, v_author, v_source_url, v_normalized_url, v_reading.sections, v_hash, v_reading.format, v_reading.cover_url, v_reading.lang, v_reading.kind);
  insert into public.audit_logs (actor_user_id, actor_role, action, target_type, target_id, payload)
  values (auth.uid(), 'user', 'recommendation.pending_created', 'recommendation_submission', v_id, jsonb_build_object('reading_id', p_reading_id));
  return v_result;
end; $$;

create or replace function public.list_submittable_readings()
returns table (id text, title text, author text, source_url text)
language sql security definer set search_path = public as $$
  select r.id, r.title, r.author, r.source_url
  from public.readings r
  where r.user_id = auth.uid() and r.origin = 'imported' and r.deleted_at is null
    and exists (select 1 from public.reading_marks m where m.reading_id = r.id and m.user_id = auth.uid() and m.completed)
    and not exists (select 1 from public.recommendation_submissions s where s.reading_id = r.id)
  order by r.updated_at desc
$$;

grant execute on function public.submit_recommendation_for_review(text, text, text, text) to authenticated;
grant execute on function public.list_submittable_readings() to authenticated;

-- 管理员审核接口：状态流转和审计在服务端完成，普通用户不具备主表写权限。
create or replace function public.admin_list_recommendation_submissions()
returns jsonb
language sql security definer set search_path = public as $$
  select case when public.is_current_user_admin() then coalesce(jsonb_agg(
    to_jsonb(s) || jsonb_build_object('internal_note', r.internal_note)
    order by case s.status when 'pending' then 0 when 'approved' then 1 when 'removed' then 2 else 3 end, s.created_at asc
  ), '[]'::jsonb) else '[]'::jsonb end
  from public.recommendation_submissions s
  left join public.recommendation_submission_admin_reviews r on r.submission_id = s.id
$$;

create or replace function public.admin_update_recommendation_editorial(
  p_submission_id text, p_title text, p_author text, p_source_url text,
  p_intro text, p_keywords text[], p_keywords_trans text[], p_excerpts text[], p_excerpts_trans text[], p_internal_note text default null
)
returns public.recommendation_submissions
language plpgsql security definer set search_path = public as $$
declare v_result public.recommendation_submissions%rowtype;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  update public.recommendation_submissions
  set title = coalesce(p_title, title), author = p_author, source_url = p_source_url,
      intro = coalesce(p_intro, ''), keywords = coalesce(p_keywords, '{}'), keywords_trans = nullif(p_keywords_trans, '{}'),
      excerpts = coalesce(p_excerpts, '{}'), excerpts_trans = nullif(p_excerpts_trans, '{}'), updated_at = now()
  where id = p_submission_id and status in ('pending', 'approved', 'removed')
  returning * into v_result;
  if not found then raise exception '仅待审核、已通过或已下架内容可编辑；已发布内容请先下架'; end if;
  insert into public.recommendation_submission_admin_reviews (submission_id, internal_note, reviewed_by, reviewed_at, updated_at)
  values (p_submission_id, p_internal_note, auth.uid(), now(), now())
  on conflict (submission_id) do update set internal_note = excluded.internal_note, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at;
  insert into public.audit_logs (actor_user_id, actor_role, action, target_type, target_id)
  values (auth.uid(), 'admin', 'recommendation.editorial_updated', 'recommendation_submission', p_submission_id);
  return v_result;
end; $$;

create or replace function public.admin_approve_recommendation(p_submission_id text, p_internal_note text default null)
returns public.recommendation_submissions
language plpgsql security definer set search_path = public as $$
declare v_result public.recommendation_submissions%rowtype;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  update public.recommendation_submissions set status = 'approved', approved_at = now(), rejection_reason = null, rejection_at = null, updated_at = now()
  where id = p_submission_id and status in ('pending', 'removed') returning * into v_result;
  if not found then raise exception '仅待审核或已下架内容可以通过审核'; end if;
  insert into public.recommendation_submission_admin_reviews (submission_id, internal_note, reviewed_by, reviewed_at, updated_at)
  values (p_submission_id, p_internal_note, auth.uid(), now(), now()) on conflict (submission_id) do update set internal_note = excluded.internal_note, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at;
  insert into public.audit_logs (actor_user_id, actor_role, action, target_type, target_id) values (auth.uid(), 'admin', 'recommendation.approved', 'recommendation_submission', p_submission_id);
  return v_result;
end; $$;

create or replace function public.admin_reject_recommendation(p_submission_id text, p_rejection_reason text, p_internal_note text default null)
returns public.recommendation_submissions
language plpgsql security definer set search_path = public as $$
declare v_result public.recommendation_submissions%rowtype;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  if nullif(trim(p_rejection_reason), '') is null then raise exception '请填写驳回原因'; end if;
  update public.recommendation_submissions set status = 'rejected', rejection_reason = trim(p_rejection_reason), rejection_at = now(), updated_at = now()
  where id = p_submission_id and status in ('pending', 'approved') returning * into v_result;
  if not found then raise exception '仅待审核或已通过内容可以驳回'; end if;
  insert into public.recommendation_submission_admin_reviews (submission_id, internal_note, reviewed_by, reviewed_at, updated_at)
  values (p_submission_id, p_internal_note, auth.uid(), now(), now()) on conflict (submission_id) do update set internal_note = excluded.internal_note, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at;
  insert into public.audit_logs (actor_user_id, actor_role, action, target_type, target_id) values (auth.uid(), 'admin', 'recommendation.rejected', 'recommendation_submission', p_submission_id);
  return v_result;
end; $$;

create or replace function public.admin_publish_recommendation(p_submission_id text, p_internal_note text default null)
returns public.recommendation_submissions
language plpgsql security definer set search_path = public as $$
declare v_result public.recommendation_submissions%rowtype;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  update public.recommendation_submissions set status = 'active', first_published_at = coalesce(first_published_at, now()), published_at = now(), updated_at = now()
  where id = p_submission_id and status = 'approved' and length(trim(intro)) > 0 and cardinality(excerpts) between 1 and 5 returning * into v_result;
  if not found then raise exception '发布前需处于已通过状态，并填写推荐语及 1 至 5 条摘录'; end if;
  insert into public.recommendation_submission_admin_reviews (submission_id, internal_note, reviewed_by, reviewed_at, updated_at)
  values (p_submission_id, p_internal_note, auth.uid(), now(), now()) on conflict (submission_id) do update set internal_note = excluded.internal_note, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at;
  insert into public.audit_logs (actor_user_id, actor_role, action, target_type, target_id) values (auth.uid(), 'admin', 'recommendation.published', 'recommendation_submission', p_submission_id);
  return v_result;
end; $$;

create or replace function public.admin_remove_recommendation(p_submission_id text, p_removal_reason text, p_internal_note text default null)
returns public.recommendation_submissions
language plpgsql security definer set search_path = public as $$
declare v_result public.recommendation_submissions%rowtype;
begin
  if not public.is_current_user_admin() then raise exception '无管理员权限'; end if;
  if nullif(trim(p_removal_reason), '') is null then raise exception '请填写下架原因'; end if;
  update public.recommendation_submissions set status = 'removed', removal_reason = trim(p_removal_reason), removed_at = now(), updated_at = now()
  where id = p_submission_id and status = 'active' returning * into v_result;
  if not found then raise exception '仅已发布内容可以下架'; end if;
  insert into public.recommendation_submission_admin_reviews (submission_id, internal_note, reviewed_by, reviewed_at, updated_at)
  values (p_submission_id, p_internal_note, auth.uid(), now(), now()) on conflict (submission_id) do update set internal_note = excluded.internal_note, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at;
  insert into public.audit_logs (actor_user_id, actor_role, action, target_type, target_id) values (auth.uid(), 'admin', 'recommendation.removed', 'recommendation_submission', p_submission_id);
  return v_result;
end; $$;

-- 加入书架时只读取与当前 active 推荐绑定的提交快照。
create or replace function public.get_recommendation_snapshot(p_submission_id text)
returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('title', x.title, 'author', x.author, 'source_url', x.source_url,
    'sections', x.sections, 'format', x.format, 'cover_url', x.cover_url, 'lang', x.lang, 'kind', x.kind)
  from public.recommendation_submission_snapshots x
  join public.recommendation_submissions s on s.id = x.submission_id
  where x.submission_id = p_submission_id and s.status = 'active'
$$;

grant execute on function public.admin_list_recommendation_submissions() to authenticated;
grant execute on function public.admin_update_recommendation_editorial(text, text, text, text, text, text[], text[], text[], text[], text) to authenticated;
grant execute on function public.admin_approve_recommendation(text, text) to authenticated;
grant execute on function public.admin_reject_recommendation(text, text, text) to authenticated;
grant execute on function public.admin_publish_recommendation(text, text) to authenticated;
grant execute on function public.admin_remove_recommendation(text, text, text) to authenticated;
grant execute on function public.get_recommendation_snapshot(text) to authenticated;
notify pgrst, 'reload schema';

commit;
