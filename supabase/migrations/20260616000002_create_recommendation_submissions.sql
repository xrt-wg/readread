-- ═══════════════════════════════════════════════════════════
-- 社区众包推荐系统 Phase 0 / 任务 0.2 + 0.7
-- 创建 recommendation_submissions 表（含 CHECK 约束、索引、RLS、GRANT、触发器）
-- ═══════════════════════════════════════════════════════════

-- 1. 建表
CREATE TABLE IF NOT EXISTS public.recommendation_submissions (
  id                  text PRIMARY KEY,                    -- "rec_" + timestamp + random5
  submitter_user_id   uuid NOT NULL REFERENCES public.profiles(user_id),

  -- 引用（不复制正文）
  import_item_id      text NOT NULL,                       -- 指向 submitter 自己的 import_items.id

  -- 展示快照（提交时刻冻结，避免 RLS 泄漏）
  title               text NOT NULL,
  author              text,
  source_url          text,

  -- 用户填写
  intro               text NOT NULL DEFAULT '',
  keywords            text[] NOT NULL DEFAULT '{}',
  excerpt             text NOT NULL DEFAULT '',

  -- 计算/缓存
  add_count           integer NOT NULL DEFAULT 0,
  recommend_score     integer NOT NULL DEFAULT 0,

  -- 状态
  status              text NOT NULL DEFAULT 'active',

  -- 时间戳
  created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- ═══════════════════════════════════════════════════════════
-- 2. CHECK 约束
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.recommendation_submissions
  ADD CONSTRAINT recommendation_submissions_status_check
  CHECK (status IN ('active', 'removed'));

ALTER TABLE public.recommendation_submissions
  ADD CONSTRAINT recommendation_submissions_intro_check
  CHECK (length(intro) > 0);

ALTER TABLE public.recommendation_submissions
  ADD CONSTRAINT recommendation_submissions_excerpt_check
  CHECK (length(excerpt) > 0);

-- ═══════════════════════════════════════════════════════════
-- 3. 索引
-- ═══════════════════════════════════════════════════════════

-- 推荐列表主查询（active 条目按 score 排序）
CREATE INDEX IF NOT EXISTS idx_rec_submissions_active_score
  ON public.recommendation_submissions (status, recommend_score DESC)
  WHERE status = 'active';

-- 按提交者查询（"我的推荐"列表）
CREATE INDEX IF NOT EXISTS idx_rec_submissions_submitter
  ON public.recommendation_submissions (submitter_user_id, created_at DESC);

-- 重复检测——按 source_url 查已有提交
CREATE INDEX IF NOT EXISTS idx_rec_submissions_source_url
  ON public.recommendation_submissions (source_url)
  WHERE source_url IS NOT NULL AND status = 'active';

-- 引用回溯
CREATE INDEX IF NOT EXISTS idx_rec_submissions_import_item
  ON public.recommendation_submissions (import_item_id);

-- ═══════════════════════════════════════════════════════════
-- 4. RLS 策略
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.recommendation_submissions ENABLE ROW LEVEL SECURITY;

-- 所有人可读 active 条目（包括匿名用户）
CREATE POLICY "Anyone can view active submissions"
  ON public.recommendation_submissions FOR SELECT
  USING (status = 'active');

-- 已登录用户可读自己的所有条目（包括 removed）
CREATE POLICY "Users can view own submissions"
  ON public.recommendation_submissions FOR SELECT
  USING (auth.uid() = submitter_user_id);

-- 已登录用户可提交推荐
CREATE POLICY "Users can insert submissions"
  ON public.recommendation_submissions FOR INSERT
  WITH CHECK (auth.uid() = submitter_user_id);

-- 提交者可以更新自己的条目（用于编辑 intro/keywords/excerpt 或下架）
CREATE POLICY "Users can update own submissions"
  ON public.recommendation_submissions FOR UPDATE
  USING (auth.uid() = submitter_user_id)
  WITH CHECK (auth.uid() = submitter_user_id);

-- 不授权 DELETE——条目通过 status = 'removed' 下架

-- ═══════════════════════════════════════════════════════════
-- 5. 权限授予
-- ═══════════════════════════════════════════════════════════

-- 匿名用户可浏览 active 推荐条目
GRANT SELECT ON public.recommendation_submissions TO anon;
-- 已登录用户可读写
GRANT SELECT, INSERT, UPDATE ON public.recommendation_submissions TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 6. 自动触发器（updated_at）
-- ═══════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_rec_submissions_set_updated_at ON public.recommendation_submissions;
CREATE TRIGGER trg_rec_submissions_set_updated_at
  BEFORE UPDATE ON public.recommendation_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_record_updated_at();
