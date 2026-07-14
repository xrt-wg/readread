-- ============================================================================
-- Migration: 服务端书签复习筛选 RPC
-- 日期: 2026-07-14
-- 说明: 替代客户端全量下载 + JS 分类/排序, 服务端按优先级返回
--       新建 > 到期 > 补位, 上限 p_limit
-- ============================================================================

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
  -- 统计新卡片
  SELECT COUNT(*) INTO v_new_count
  FROM public.bookmarks
  WHERE user_id = p_user_id
    AND (review_count IS NULL OR review_count = 0)
    AND deleted_at IS NULL;

  -- 统计到期卡片
  SELECT COUNT(*) INTO v_due_count
  FROM public.bookmarks
  WHERE user_id = p_user_id
    AND review_count > 0
    AND next_review_at <= NOW()
    AND deleted_at IS NULL;

  RETURN QUERY (
    -- 新卡片优先
    SELECT * FROM (
      SELECT b.*, r.title AS article_title
      FROM public.bookmarks b
      JOIN public.readings r ON r.id = b.reading_id
      WHERE b.user_id = p_user_id
        AND (b.review_count IS NULL OR b.review_count = 0)
        AND b.deleted_at IS NULL
      ORDER BY b.created_at DESC
      LIMIT p_limit
    ) AS new_cards

    UNION ALL

    -- 到期卡片其次
    SELECT * FROM (
      SELECT b.*, r.title AS article_title
      FROM public.bookmarks b
      JOIN public.readings r ON r.id = b.reading_id
      WHERE b.user_id = p_user_id
        AND b.review_count > 0
        AND b.next_review_at <= NOW()
        AND b.deleted_at IS NULL
      ORDER BY b.next_review_at ASC
      LIMIT GREATEST(0, p_limit - v_new_count)
    ) AS due_cards

    UNION ALL

    -- 不够 p_limit 用未来卡片补位
    SELECT * FROM (
      SELECT b.*, r.title AS article_title
      FROM public.bookmarks b
      JOIN public.readings r ON r.id = b.reading_id
      WHERE b.user_id = p_user_id
        AND b.review_count > 0
        AND b.next_review_at > NOW()
        AND b.deleted_at IS NULL
      ORDER BY b.next_review_at ASC
      LIMIT GREATEST(0, p_limit - v_new_count - v_due_count)
    ) AS future_cards
  );
END;
$$;
