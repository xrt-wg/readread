-- 修复提交推荐时 pgcrypto digest 的 schema 解析。
-- Supabase 默认将 pgcrypto 安装在 extensions schema；原函数的 search_path 仅含 public。
begin;

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

notify pgrst, 'reload schema';
commit;
