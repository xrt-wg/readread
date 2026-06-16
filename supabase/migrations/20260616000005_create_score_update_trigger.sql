-- ═══════════════════════════════════════════════════════════
-- 社区众包推荐系统 Phase 0 / 任务 0.5
-- 评分变化时自动更新 recommend_score 缓存的触发器
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_recommendation_score()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_id text;
BEGIN
  -- DELETE 时 NEW 为 NULL，使用 OLD.submission_id
  target_id := COALESCE(NEW.submission_id, OLD.submission_id);
  UPDATE public.recommendation_submissions
  SET recommend_score = public.compute_recommendation_score(target_id)
  WHERE id = target_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_rec_ratings_update_score ON public.recommendation_ratings;
CREATE TRIGGER trg_rec_ratings_update_score
  AFTER INSERT OR UPDATE OR DELETE ON public.recommendation_ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_recommendation_score();
