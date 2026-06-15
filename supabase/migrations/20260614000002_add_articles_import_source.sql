-- 书架与阅读区 — articles 表补充
-- Phase 0 / 任务 0.2
-- 新增 source_import_id + imported_at 字段（可空，无 FK 约束）

-- ═══════════════════════════════════════════════════════════
-- 1. articles 新增字段
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS source_import_id text;

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;

-- ═══════════════════════════════════════════════════════════
-- 2. 索引
-- ═══════════════════════════════════════════════════════════

-- 阅读区溯源查询（条件索引，仅非空值）
CREATE INDEX IF NOT EXISTS idx_articles_source_import
  ON public.articles (source_import_id)
  WHERE source_import_id IS NOT NULL;
