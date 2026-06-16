-- ═══════════════════════════════════════════════════════════
-- 社区众包推荐系统 Phase 0 / 任务 0.3 + 0.7
-- 创建 recommendation_ratings 表（含 CHECK 约束、索引、RLS、GRANT、触发器）
-- ═══════════════════════════════════════════════════════════

-- 1. 建表
CREATE TABLE IF NOT EXISTS public.recommendation_ratings (
  submission_id       text NOT NULL REFERENCES public.recommendation_submissions(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES public.profiles(user_id),

  rating              text NOT NULL,                       -- 'recommend' | 'average' | 'not_good'

  created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),

  PRIMARY KEY (submission_id, user_id)                     -- 一人一票
);

-- ═══════════════════════════════════════════════════════════
-- 2. CHECK 约束
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.recommendation_ratings
  ADD CONSTRAINT recommendation_ratings_rating_check
  CHECK (rating IN ('recommend', 'average', 'not_good'));

-- ═══════════════════════════════════════════════════════════
-- 3. 索引
-- ═══════════════════════════════════════════════════════════

-- 按提交条目查评分分布（score 计算用）
CREATE INDEX IF NOT EXISTS idx_rec_ratings_submission
  ON public.recommendation_ratings (submission_id);

-- 按用户查评分历史
CREATE INDEX IF NOT EXISTS idx_rec_ratings_user
  ON public.recommendation_ratings (user_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════
-- 4. RLS 策略
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.recommendation_ratings ENABLE ROW LEVEL SECURITY;

-- 所有人可读评分数据（用于展示评分分布）
CREATE POLICY "Anyone can view ratings"
  ON public.recommendation_ratings FOR SELECT
  USING (true);

-- 已登录用户可提交评分
CREATE POLICY "Users can insert ratings"
  ON public.recommendation_ratings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 用户可更新自己的评分
CREATE POLICY "Users can update own ratings"
  ON public.recommendation_ratings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 不授权 DELETE——评分不可删除（可改为"一般"但不能移除）

-- ═══════════════════════════════════════════════════════════
-- 5. 权限授予
-- ═══════════════════════════════════════════════════════════

GRANT SELECT ON public.recommendation_ratings TO anon;
GRANT SELECT, INSERT, UPDATE ON public.recommendation_ratings TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 6. 自动触发器（updated_at）
-- ═══════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_rec_ratings_set_updated_at ON public.recommendation_ratings;
CREATE TRIGGER trg_rec_ratings_set_updated_at
  BEFORE UPDATE ON public.recommendation_ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_record_updated_at();
