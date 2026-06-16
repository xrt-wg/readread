-- ═══════════════════════════════════════════════════════════
-- 社区众包推荐系统 Phase 0 / 任务 0.1
-- 扩展 import_items.origin CHECK 约束，增加 'featured' 和 'featured_legacy'
-- ═══════════════════════════════════════════════════════════

-- 1. 删除旧约束
ALTER TABLE public.import_items
  DROP CONSTRAINT IF EXISTS import_items_origin_check;

-- 2. 创建新约束（扩展为 4 个值）
ALTER TABLE public.import_items
  ADD CONSTRAINT import_items_origin_check
  CHECK (origin IN ('imported', 'shared', 'featured', 'featured_legacy'));
