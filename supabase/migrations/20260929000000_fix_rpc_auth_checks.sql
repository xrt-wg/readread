-- ============================================================================
-- Migration: 越权修复 — 4 个 SECURITY DEFINER RPC 补 auth.uid() 校验（发布前 P1-1）
-- 日期: 2026-09-29
-- 说明: get_due_bookmarks / upsert_reading_mark_position /
--       clear_reading_mark_position / set_reading_mark_completed
--       此前接收 p_user_id 后直接使用，未校验 p_user_id = auth.uid()，
--       任意登录用户可读取他人收藏、改写/清空他人阅读进度（IDOR）。
--       本次在函数体首部加统一闸门；函数签名保持不变（前端仍传本人 userId）。
-- 执行方式: Dashboard SQL Editor 手动执行（无本地 CLI），执行后逐条校验。
-- ============================================================================

-- ─── 1. get_due_bookmarks ────────────────────────────────────────────────────
-- 当前版本见 20260921000000_add_bookmark_status.sql；此处 OR REPLACE 仅加闸门。
CREATE OR REPLACE FUNCTION get_due_bookmarks(
  p_user_id uuid,
  p_limit int DEFAULT 20
)
RETURNS TABLE(
  id text, user_id uuid, reading_id text, type text, text text,
  translation text, translation_provider text,
  context_sentence text, context_translation text,
  translation_status text, paragraph_index int, char_offset int,
  review_count int, next_review_at timestamptz, familiarity smallint,
  section_id text, section_heading text,
  created_at timestamptz, updated_at timestamptz, deleted_at timestamptz,
  status text, archived_at timestamptz,
  article_title text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_new_count int;
  v_due_count int;
BEGIN
  -- 越权闸门：仅允许查询本人收藏
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_new_count
  FROM public.bookmarks b
  WHERE b.user_id = p_user_id
    AND (b.review_count IS NULL OR b.review_count = 0)
    AND b.status = 'active'
    AND b.deleted_at IS NULL;

  SELECT COUNT(*) INTO v_due_count
  FROM public.bookmarks b
  WHERE b.user_id = p_user_id
    AND b.review_count > 0
    AND b.next_review_at <= NOW()
    AND b.status = 'active'
    AND b.deleted_at IS NULL;

  RETURN QUERY (
    SELECT * FROM (
      SELECT
        b.id, b.user_id, b.reading_id, b.type, b.text,
        b.translation, b.translation_provider,
        b.context_sentence, b.context_translation,
        b.translation_status, b.paragraph_index, b.char_offset,
        b.review_count, b.next_review_at, b.familiarity,
        b.section_id, b.section_heading,
        b.created_at, b.updated_at, b.deleted_at,
        b.status, b.archived_at,
        r.title AS article_title
      FROM public.bookmarks b
      JOIN public.readings r ON r.id = b.reading_id
      WHERE b.user_id = p_user_id
        AND (b.review_count IS NULL OR b.review_count = 0)
        AND b.status = 'active'
        AND b.deleted_at IS NULL
      ORDER BY b.created_at DESC
      LIMIT p_limit
    ) AS new_cards

    UNION ALL

    SELECT * FROM (
      SELECT
        b.id, b.user_id, b.reading_id, b.type, b.text,
        b.translation, b.translation_provider,
        b.context_sentence, b.context_translation,
        b.translation_status, b.paragraph_index, b.char_offset,
        b.review_count, b.next_review_at, b.familiarity,
        b.section_id, b.section_heading,
        b.created_at, b.updated_at, b.deleted_at,
        b.status, b.archived_at,
        r.title AS article_title
      FROM public.bookmarks b
      JOIN public.readings r ON r.id = b.reading_id
      WHERE b.user_id = p_user_id
        AND b.review_count > 0
        AND b.next_review_at <= NOW()
        AND b.status = 'active'
        AND b.deleted_at IS NULL
      ORDER BY b.next_review_at ASC
      LIMIT GREATEST(0, p_limit - v_new_count)
    ) AS due_cards

    UNION ALL

    SELECT * FROM (
      SELECT
        b.id, b.user_id, b.reading_id, b.type, b.text,
        b.translation, b.translation_provider,
        b.context_sentence, b.context_translation,
        b.translation_status, b.paragraph_index, b.char_offset,
        b.review_count, b.next_review_at, b.familiarity,
        b.section_id, b.section_heading,
        b.created_at, b.updated_at, b.deleted_at,
        b.status, b.archived_at,
        r.title AS article_title
      FROM public.bookmarks b
      JOIN public.readings r ON r.id = b.reading_id
      WHERE b.user_id = p_user_id
        AND b.review_count > 0
        AND b.next_review_at > NOW()
        AND b.status = 'active'
        AND b.deleted_at IS NULL
      ORDER BY b.next_review_at ASC
      LIMIT GREATEST(0, p_limit - v_new_count - v_due_count)
    ) AS future_cards
  );
END;
$$;

-- ─── 2. upsert_reading_mark_position ─────────────────────────────────────────
-- 当前版本见 20260713000001_reading_mark_partial_upsert.sql；仅加闸门。
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
  -- 越权闸门：仅允许写本人进度
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

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

-- ─── 3. clear_reading_mark_position ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION clear_reading_mark_position(
  p_user_id uuid,
  p_reading_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 越权闸门：仅允许清本人进度
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.reading_marks
  SET paragraph_index = NULL, updated_at = NOW()
  WHERE user_id = p_user_id AND reading_id = p_reading_id;
END;
$$;

-- ─── 4. set_reading_mark_completed ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_reading_mark_completed(
  p_user_id uuid,
  p_reading_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 越权闸门：仅允许标记本人进度完成
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.reading_marks (user_id, reading_id, completed, progress_percent, updated_at)
  VALUES (p_user_id, p_reading_id, true, 100, NOW())
  ON CONFLICT (user_id, reading_id)
  DO UPDATE SET
    completed = true,
    progress_percent = 100,
    updated_at = NOW();
END;
$$;
