-- ============================================================================
-- Migration: 收藏状态字段（归档能力）
-- 日期: 2026-09-21
-- 说明: bookmarks 新增 status 枚举 + archived_at 辅助时间戳，
--       并重写 get_due_bookmarks 排除已归档收藏。
-- 执行方式: Dashboard SQL Editor 手动执行（无本地 CLI）
-- 关联文档: Pre-docs/开发/20_收藏归档_2026-09-21/02_实施方案.md
-- ============================================================================

-- Step 1: 状态字段
ALTER TABLE public.bookmarks ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.bookmarks DROP CONSTRAINT IF EXISTS bookmarks_status_check;
ALTER TABLE public.bookmarks ADD CONSTRAINT bookmarks_status_check CHECK (status IN ('active', 'archived'));

ALTER TABLE public.bookmarks ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Step 2: 重写 get_due_bookmarks —— 沿用 20260717000001 的显式列清单写法
-- （translation_provider 追加导致物理列序与 RETURNS TABLE 约定不符，b.* 不可用）
-- 增量: 三处 SELECT 列清单插入 b.status/b.archived_at；RETURNS TABLE 补列；
--       五个 WHERE（2 COUNT + 3 子查询）补 b.status='active'；
--       两个 COUNT 子查询调度字段全限定 b.（RETURNS TABLE 列名即输出变量，
--       未限定同名列有歧义——20260717000000 曾修复该类问题）
-- 注意: 返回类型新增列 → 行类型变化，CREATE OR REPLACE 报 42P13，
--       需先 DROP 再建。原函数无显式 GRANT（依赖 PostgreSQL 默认
--       PUBLIC EXECUTE），DROP 重建后权限不变。
DROP FUNCTION IF EXISTS public.get_due_bookmarks(uuid, integer);
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
