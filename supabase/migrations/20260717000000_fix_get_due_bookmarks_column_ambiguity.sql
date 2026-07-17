-- Recreate the review-selection RPC with explicitly qualified bookmark columns.
--
-- In a PL/pgSQL function, RETURNS TABLE column names are output variables.
-- Therefore unqualified bookmark columns such as `user_id` are ambiguous when
-- they have the same name as an output column.

CREATE OR REPLACE FUNCTION public.get_due_bookmarks(
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
  SELECT COUNT(*) INTO v_new_count
  FROM public.bookmarks b
  WHERE b.user_id = p_user_id
    AND (b.review_count IS NULL OR b.review_count = 0)
    AND b.deleted_at IS NULL;

  SELECT COUNT(*) INTO v_due_count
  FROM public.bookmarks b
  WHERE b.user_id = p_user_id
    AND b.review_count > 0
    AND b.next_review_at <= NOW()
    AND b.deleted_at IS NULL;

  RETURN QUERY (
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
