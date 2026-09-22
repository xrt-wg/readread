-- ============================================================================
-- Migration: 推荐区正文策展（上架前排版保障）
-- 日期: 2026-09-22
-- 说明: 为推荐快照新增「管理员策展正文」层 curated_sections/curated_at，
--       保留提交时的 sections/content_hash 不变（不可变 + 去重基线）；
--       新增 admin_update_recommendation_content 供管理员在上架前修正正文排版；
--       改写 get_recommendation_snapshot（加入书架）优先返回策展正文，
--       并让标题/作者/来源取提交表现行值，修复「卡片显示 vs 导入内容」不一致；
--       扩展 admin_get_recommendation_submission_detail 返回策展信息。
-- 执行方式: Dashboard SQL Editor 手动执行（无本地 CLI）
-- ============================================================================

begin;

-- Step 1: 快照表新增策展层
alter table public.recommendation_submission_snapshots
  add column if not exists curated_sections jsonb,
  add column if not exists curated_at timestamptz;

-- Step 2: 管理员策展正文（仅待审核/已通过/已下架；已发布需先下架）
-- 校验：非空数组 + 逐元素含 body 对象且 body.text/body.markdown 至少其一为字符串
--   （结构比较用 IS DISTINCT FROM 做 NULL 安全比较，避免键缺失时 SQL 三值逻辑漏判——实施后审核 M1）
-- 审计：payload 记录提交指纹 content_hash 与是否首次策展（L2）
create or replace function public.admin_update_recommendation_content(
  p_submission_id text,
  p_sections jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_prev_curated_at timestamptz;
  v_content_hash text;
  v_section jsonb;
begin
  if not public.is_current_user_admin() then
    raise exception '无管理员权限';
  end if;
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' then
    raise exception '正文结构不合法：须为非空数组';
  end if;
  if jsonb_array_length(p_sections) = 0 then
    raise exception '正文结构不合法：须为非空数组';
  end if;
  for v_section in select jsonb_array_elements(p_sections) loop
    if jsonb_typeof(v_section) is distinct from 'object'
       or jsonb_typeof(v_section->'body') is distinct from 'object'
       or (jsonb_typeof(v_section->'body'->'text') is distinct from 'string'
           and jsonb_typeof(v_section->'body'->'markdown') is distinct from 'string') then
      raise exception '正文结构不合法：每节须含 body.text 或 body.markdown 字符串';
    end if;
  end loop;
  select status into v_status from public.recommendation_submissions where id = p_submission_id;
  if v_status is null then
    raise exception '推荐提交不存在';
  end if;
  if v_status not in ('pending', 'approved', 'removed') then
    raise exception '仅待审核、已通过或已下架内容可编辑正文；已发布内容请先下架';
  end if;
  select curated_at, content_hash into v_prev_curated_at, v_content_hash
    from public.recommendation_submission_snapshots where submission_id = p_submission_id;
  if not found then
    raise exception '该提交没有正文快照，无法编辑';
  end if;
  update public.recommendation_submission_snapshots
    set curated_sections = p_sections, curated_at = now()
    where submission_id = p_submission_id;
  insert into public.audit_logs (actor_user_id, actor_role, action, target_type, target_id, payload)
    values (auth.uid(), 'admin', 'recommendation.content_curated', 'recommendation_submission', p_submission_id,
      jsonb_build_object('content_hash', v_content_hash, 'first_curation', v_prev_curated_at is null));
  return jsonb_build_object('submission_id', p_submission_id);
end;
$$;

-- Step 3: 加入书架 → 策展正文优先 + 标题/作者/来源取提交表现行值
-- 注（M1）：author/source_url 取发布态列 s.author/s.source_url，不做 coalesce——
--   管理员清空作者/来源后应回退为空，而非「复活」提交时冻结值。
--   sections 的 coalesce(curated_sections, sections) 仍必须保留（无策展回退提交原样）。
create or replace function public.get_recommendation_snapshot(p_submission_id text)
returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'title', s.title, 'author', s.author, 'source_url', s.source_url,
    'sections', coalesce(x.curated_sections, x.sections),
    'format', x.format, 'cover_url', x.cover_url, 'lang', x.lang, 'kind', x.kind)
  from public.recommendation_submission_snapshots x
  join public.recommendation_submissions s on s.id = x.submission_id
  where x.submission_id = p_submission_id and s.status = 'active'
$$;

-- Step 4: 管理员详情 → 附带策展信息（面板据此渲染 + 显示「已策展」）
create or replace function public.admin_get_recommendation_submission_detail(p_submission_id text)
returns jsonb language sql security definer set search_path = public as $$
  select case when public.is_current_user_admin() then jsonb_build_object(
    'submission', to_jsonb(s), 'internal_note', r.internal_note, 'reviewed_at', r.reviewed_at,
    'snapshot', case when x.submission_id is null then null else jsonb_build_object(
      'content_hash', x.content_hash, 'sections', x.sections,
      'curated_sections', x.curated_sections, 'curated_at', x.curated_at,
      'created_at', x.created_at, 'title', x.title, 'author', x.author, 'source_url', x.source_url)
    end
  ) else null end
  from public.recommendation_submissions s
  left join public.recommendation_submission_admin_reviews r on r.submission_id = s.id
  left join public.recommendation_submission_snapshots x on x.submission_id = s.id
  where s.id = p_submission_id
$$;

revoke all on function public.admin_update_recommendation_content(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_update_recommendation_content(text, jsonb) to authenticated;
notify pgrst, 'reload schema';

commit;
