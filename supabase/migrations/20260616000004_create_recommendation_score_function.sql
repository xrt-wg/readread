-- ═══════════════════════════════════════════════════════════
-- 社区众包推荐系统 Phase 0 / 任务 0.4
-- 推荐值计算函数
-- 公式: add_count + recommend_count × 2 - not_good_count
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compute_recommendation_score(p_submission_id text)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  WITH rating_counts AS (
    SELECT
      COALESCE(SUM(CASE WHEN rating = 'recommend' THEN 1 ELSE 0 END), 0) AS recommend_count,
      COALESCE(SUM(CASE WHEN rating = 'not_good' THEN 1 ELSE 0 END), 0) AS not_good_count
    FROM public.recommendation_ratings
    WHERE submission_id = p_submission_id
  ),
  submission_data AS (
    SELECT add_count FROM public.recommendation_submissions WHERE id = p_submission_id
  )
  SELECT
    COALESCE(s.add_count, 0)
    + COALESCE(r.recommend_count, 0) * 2
    - COALESCE(r.not_good_count, 0)
  FROM submission_data s, rating_counts r;
$$;
