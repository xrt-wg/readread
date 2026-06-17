-- ═══════════════════════════════════════════════════════════
-- 推荐区功能更新：多条摘录 + 翻译字段
-- 1. excerpt text → excerpts text[]（旧数据自动包装）
-- 2. 新增 title_trans / keywords_trans / excerpts_trans（全部可空）
-- 3. 摘录数量 CHECK 约束：1-5 条
-- ═══════════════════════════════════════════════════════════

-- 1. 先删除旧 CHECK 约束（依赖于旧字段类型）
ALTER TABLE public.recommendation_submissions
  DROP CONSTRAINT IF EXISTS recommendation_submissions_excerpt_check;

-- 2. 重命名
ALTER TABLE public.recommendation_submissions
  RENAME COLUMN excerpt TO excerpts;

-- 3. 去掉旧默认值 + 转换类型 + 设新默认值
ALTER TABLE public.recommendation_submissions
  ALTER COLUMN excerpts DROP DEFAULT;

ALTER TABLE public.recommendation_submissions
  ALTER COLUMN excerpts TYPE text[] USING ARRAY[excerpts];

ALTER TABLE public.recommendation_submissions
  ALTER COLUMN excerpts SET DEFAULT '{}';

-- 2. 新增翻译字段（全部可空，不强制填写）
ALTER TABLE public.recommendation_submissions
  ADD COLUMN IF NOT EXISTS title_trans text;

ALTER TABLE public.recommendation_submissions
  ADD COLUMN IF NOT EXISTS keywords_trans text[];

ALTER TABLE public.recommendation_submissions
  ADD COLUMN IF NOT EXISTS excerpts_trans text[];

-- 6. 添加新 CHECK 约束（1-5 条摘录）
ALTER TABLE public.recommendation_submissions
  ADD CONSTRAINT recommendation_submissions_excerpts_check
  CHECK (array_length(excerpts, 1) > 0 AND array_length(excerpts, 1) <= 5);
