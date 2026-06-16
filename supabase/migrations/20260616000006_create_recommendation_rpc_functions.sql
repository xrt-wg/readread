-- ═══════════════════════════════════════════════════════════
-- 社区众包推荐系统 Phase 0 / 任务 0.6
-- 创建 3 个 SECURITY DEFINER RPC 函数
--   1. get_import_item_for_recommendation — 跨用户读取 import_item
--   2. increment_recommendation_add_count   — 更新 add_count + score
--   3. check_import_item_reading_completed  — 检查是否已读完
-- ═══════════════════════════════════════════════════════════

-- ─── RPC 1：跨用户读取 import_item ────────────────────────

CREATE OR REPLACE FUNCTION public.get_import_item_for_recommendation(
  p_import_item_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- 安全门控：仅当该 import_item 存在活跃推荐条目时才允许读取
  IF NOT EXISTS (
    SELECT 1 FROM public.recommendation_submissions
    WHERE import_item_id = p_import_item_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION '该内容没有对应的活跃推荐条目';
  END IF;

  SELECT row_to_json(ii.*)::jsonb INTO result
  FROM public.import_items ii
  WHERE ii.id = p_import_item_id AND ii.deleted_at IS NULL;

  IF result IS NULL THEN
    RAISE EXCEPTION '原始内容不存在或已被删除';
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_import_item_for_recommendation(text) TO authenticated;

-- ─── RPC 2：更新 add_count + recommend_score ──────────────

CREATE OR REPLACE FUNCTION public.increment_recommendation_add_count(
  p_submission_id text,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  true_count integer;
BEGIN
  -- 从 import_items 表计算权威 add_count 值（当前活跃的去重用户数）
  SELECT COUNT(DISTINCT user_id) INTO true_count
  FROM public.import_items
  WHERE share_source_id = p_submission_id
    AND origin IN ('featured', 'featured_legacy')
    AND deleted_at IS NULL;

  -- 原子更新 add_count 和 recommend_score
  UPDATE public.recommendation_submissions
  SET add_count = true_count,
      recommend_score = public.compute_recommendation_score(p_submission_id)
  WHERE id = p_submission_id AND status = 'active';
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_recommendation_add_count(text, uuid) TO authenticated;

-- ─── RPC 3：检查 import_item 对应文章是否已读完 ────────────

CREATE OR REPLACE FUNCTION public.check_import_item_reading_completed(
  p_import_item_id text,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.articles a
    JOIN public.reading_marks rm ON rm.article_id = a.id AND rm.user_id = a.user_id
    WHERE a.source_import_id = p_import_item_id
      AND a.user_id = p_user_id
      AND rm.completed = true
      AND a.deleted_at IS NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_import_item_reading_completed(text, uuid) TO authenticated;
