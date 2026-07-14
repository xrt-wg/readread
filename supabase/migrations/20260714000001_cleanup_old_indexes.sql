-- ============================================================================
-- Migration B: 清理被替换的旧索引
-- 日期: 2026-07-14
-- 前置条件: 20260713000000_performance_indexes.sql 已执行且新索引已生效
-- ============================================================================

-- 已被 idx_readings_active_zone 替代
DROP INDEX IF EXISTS idx_readings_user_status;

-- 已被 idx_readings_share_source_origin 替代
DROP INDEX IF EXISTS idx_readings_share_source;
