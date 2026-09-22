-- ============================================================================
-- Migration: 推荐提交频率限制可配置化
-- 日期: 2026-09-21
-- 说明: 新增单行配置表 recommendation_submission_config，把「提交推荐」频率上限
--       从硬编码「每 7 天 1 篇」改为后台可调的「每 N 个自然日 1 篇」；
--       语义由滚动窗口改为自然日（北京时间 0 点重置），被驳回/下架同样占用额度。
--       新增 管理端读写 + 用户额度查询 三个 RPC，并改写提交校验。
-- 执行方式: Dashboard SQL Editor 手动执行（无本地 CLI）
-- ============================================================================

begin;

-- Step 1: 单行配置表
create table if not exists public.recommendation_submission_config (
  id boolean primary key default true check (id),
  submission_limit_days integer not null default 1
    check (submission_limit_days between 1 and 365),
  updated_at timestamptz not null default timezone('utc', now())
);
insert into public.recommendation_submission_config (id) values (true)
  on conflict (id) do nothing;
alter table public.recommendation_submission_config enable row level security;
revoke all on public.recommendation_submission_config from anon, authenticated;

-- Step 2: 用户额度查询（SECURITY DEFINER，登录用户可读）
create or replace function public.get_recommendation_submission_quota()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_limit_days integer;
  v_used integer;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  select submission_limit_days into v_limit_days
    from public.recommendation_submission_config where id = true;
  if not found then v_limit_days := 1; end if;
  select count(*) into v_used
    from public.recommendation_submissions
    where submitter_user_id = auth.uid()
      and created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'
                        - (v_limit_days - 1) * interval '1 day';
  return jsonb_build_object('limitDays', v_limit_days, 'usedCount', v_used, 'canSubmit', v_used = 0);
end;
$$;

-- Step 3: 管理端读取
create or replace function public.admin_get_recommendation_submission_config()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.recommendation_submission_config;
begin
  if auth.uid() is null or not public.is_current_user_admin()
    or not exists(select 1 from public.profiles where user_id = auth.uid() and status = 'active') then
    raise exception '无管理员权限' using errcode = '42501';
  end if;
  select * into c from public.recommendation_submission_config where id = true;
  return jsonb_build_object('submissionLimitDays', c.submission_limit_days, 'updatedAt', c.updated_at);
end;
$$;

-- Step 4: 管理端保存（乐观并发 + 审计）
create or replace function public.admin_save_recommendation_submission_config(
  p_limit_days integer,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.recommendation_submission_config;
begin
  if auth.uid() is null or not public.is_current_user_admin()
    or not exists(select 1 from public.profiles where user_id = auth.uid() and status = 'active') then
    raise exception '无管理员权限' using errcode = '42501';
  end if;
  select * into c from public.recommendation_submission_config where id = true for update;
  if p_expected_updated_at is null or c.updated_at is distinct from p_expected_updated_at then
    raise exception '配置已被其他管理员修改，请重新加载后再保存';
  end if;
  if p_limit_days is null or p_limit_days < 1 or p_limit_days > 365 then
    raise exception '提交频率须为 1 至 365 之间的整数';
  end if;
  update public.recommendation_submission_config
    set submission_limit_days = p_limit_days, updated_at = clock_timestamp()
    where id = true;
  insert into public.audit_logs (actor_user_id, actor_role, action, target_type, target_id, payload)
    values (auth.uid(), 'admin', 'recommendation.submission_config_updated',
      'recommendation_submission_config', 'true',
      jsonb_build_object('before', c.submission_limit_days, 'after', p_limit_days));
  return public.admin_get_recommendation_submission_config();
end;
$$;

-- Step 5: 改写提交校验（频率限制 → 读配置 + 自然日窗口）
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
  v_limit_days integer;
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
  -- 频率校验：最近 N 个自然日（北京时间 0 点重置）内最多 1 篇；
  -- 所有状态（含 pending/approved/active/rejected/removed）均占用额度。
  select submission_limit_days into v_limit_days
    from public.recommendation_submission_config where id = true;
  if not found then v_limit_days := 1; end if;
  if (select count(*) from public.recommendation_submissions
        where submitter_user_id = auth.uid()
          and created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'
                            - (v_limit_days - 1) * interval '1 day') >= 1 then
    if v_limit_days = 1 then
      raise exception '今天已提交 1 篇推荐，明天再试';
    else
      raise exception '最近 % 天内已提交 1 篇推荐，请稍后再试', v_limit_days;
    end if;
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

revoke all on function public.get_recommendation_submission_quota(),
  public.admin_get_recommendation_submission_config(),
  public.admin_save_recommendation_submission_config(integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_recommendation_submission_quota() to authenticated;
grant execute on function public.admin_get_recommendation_submission_config() to authenticated;
grant execute on function public.admin_save_recommendation_submission_config(integer, timestamptz) to authenticated;
notify pgrst, 'reload schema';

commit;
