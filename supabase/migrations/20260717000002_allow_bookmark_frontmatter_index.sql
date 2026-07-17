-- The reader uses -1 as the stable paragraph index for Markdown front matter.
-- Keep all other negative values invalid.

ALTER TABLE public.bookmarks
  DROP CONSTRAINT IF EXISTS bookmarks_paragraph_index_check;

ALTER TABLE public.bookmarks
  ADD CONSTRAINT bookmarks_paragraph_index_check
  CHECK (paragraph_index IS NULL OR paragraph_index >= -1);
