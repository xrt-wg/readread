-- Restore the single-bookmark soft-delete RPC in the current migration chain.
-- The function runs with definer privileges but explicitly enforces ownership
-- against the authenticated caller before changing any row.

CREATE OR REPLACE FUNCTION public.soft_delete_bookmark(bookmark_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  UPDATE public.bookmarks
  SET deleted_at = timezone('utc', now())
  WHERE id = bookmark_id
    AND user_id = v_user_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bookmark not found or already deleted';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_bookmark(text) TO authenticated;
