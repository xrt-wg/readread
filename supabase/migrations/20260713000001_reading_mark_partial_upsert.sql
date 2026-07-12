-- ============================================================================
-- Migration: 阅读进度部分更新 RPC — 消除 fetch-then-upsert 双往返
-- 日期: 2026-07-13
-- 说明: saveReadingMark / clearReadingMark / setReadingMarkCompleted 各使用
--       独立 RPC，ON CONFLICT 时只更新指定列，保留 completed/completedSections
--       等不应被覆盖的字段。
-- ============================================================================

-- 1. saveReadingMark: 只更新 paragraph_index / progress_percent / section_id
--    保留 completed / completedSections 不变
CREATE OR REPLACE FUNCTION upsert_reading_mark_position(
  p_user_id uuid,
  p_reading_id text,
  p_paragraph_index int,
  p_progress_percent int DEFAULT NULL,
  p_section_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.reading_marks (user_id, reading_id, paragraph_index, progress_percent, section_id, updated_at)
  VALUES (p_user_id, p_reading_id, p_paragraph_index, p_progress_percent, p_section_id, NOW())
  ON CONFLICT (user_id, reading_id)
  DO UPDATE SET
    paragraph_index = EXCLUDED.paragraph_index,
    progress_percent = COALESCE(EXCLUDED.progress_percent, reading_marks.progress_percent),
    section_id = COALESCE(EXCLUDED.section_id, reading_marks.section_id),
    updated_at = NOW();
END;
$$;

-- 2. clearReadingMark: 清除 paragraph_index，保留 completed/completedSections
CREATE OR REPLACE FUNCTION clear_reading_mark_position(
  p_user_id uuid,
  p_reading_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.reading_marks
  SET paragraph_index = NULL, updated_at = NOW()
  WHERE user_id = p_user_id AND reading_id = p_reading_id;
END;
$$;

-- 3. setReadingMarkCompleted: 标记完成，设置 progress_percent = 100
CREATE OR REPLACE FUNCTION set_reading_mark_completed(
  p_user_id uuid,
  p_reading_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.reading_marks (user_id, reading_id, completed, progress_percent, updated_at)
  VALUES (p_user_id, p_reading_id, true, 100, NOW())
  ON CONFLICT (user_id, reading_id)
  DO UPDATE SET
    completed = true,
    progress_percent = 100,
    updated_at = NOW();
END;
$$;
