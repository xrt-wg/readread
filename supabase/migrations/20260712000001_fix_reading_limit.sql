-- ============================================================================
-- Migration: 修正 init_reading_status 可能突破阅读区上限 N=5
-- 日期: 2026-07-12
-- 说明: 每人最多保留 5 本 reading 状态，其余转回 in_progress
-- ============================================================================
WITH ranked AS (
  SELECT id, user_id,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY updated_at DESC) AS rn
  FROM public.readings
  WHERE reading_status = 'reading' AND deleted_at IS NULL
)
UPDATE public.readings r
SET reading_status = 'in_progress', updated_at = now()
FROM ranked
WHERE r.id = ranked.id AND ranked.rn > 5;
