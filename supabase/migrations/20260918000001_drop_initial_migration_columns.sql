-- ═══════════════════════════════════════════════════════════
-- 首次迁移功能遗留清理（F 类）
-- 删除 profiles 表上已冻结的迁移状态列
--   has_completed_initial_migration（boolean）
--   initial_migrated_at（timestamptz）
-- 旧「首次迁移」流程已关闭，由静默导入（migrateTrialSnapshot）取代，
-- 这两列不再被任何代码读取或写入。
-- ensure_profile() 定义为 returns public.profiles 且用 select * into 返回整行，
-- DROP 后复合类型 public.profiles 自动收窄，两列不再出现在返回结果中，无报错风险。
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS has_completed_initial_migration,
  DROP COLUMN IF EXISTS initial_migrated_at;
