-- ============================================================================
-- Migration: Phase 4 清理 — DROP 旧表/旧RPC + 列重命名
-- 日期: 2026-07-12
-- 前置条件: 20260711000000_unify_readings_table.sql 已成功执行
-- 说明: 合并完成后的收尾工作，不可逆
-- ============================================================================

-- ============================================================================
-- Step 1: DROP 旧 RPC 函数
-- ============================================================================
DROP FUNCTION IF EXISTS public.soft_delete_article(text);
DROP FUNCTION IF EXISTS public.soft_delete_bookmarks_for_article(text);
DROP FUNCTION IF EXISTS public.delete_import_item(text);
DROP FUNCTION IF EXISTS public.check_import_item_reading_completed(text, uuid);
DROP FUNCTION IF EXISTS public.get_import_item_for_recommendation(text);

-- ============================================================================
-- Step 2: DROP 旧表
-- ============================================================================
DROP TABLE IF EXISTS public.articles CASCADE;
DROP TABLE IF EXISTS public.import_items CASCADE;

-- ============================================================================
-- Step 3: 列重命名
-- ============================================================================

-- 3a: bookmarks.article_id → reading_id
-- FK 约束由 RENAME COLUMN 自动保持（使用列内部标识符），无需重建
ALTER TABLE public.bookmarks RENAME COLUMN article_id TO reading_id;
ALTER INDEX IF EXISTS idx_bookmarks_article_id RENAME TO idx_bookmarks_reading_id;

-- 3b: reading_marks.article_id → reading_id
ALTER TABLE public.reading_marks RENAME COLUMN article_id TO reading_id;
ALTER INDEX IF EXISTS idx_reading_marks_article_id RENAME TO idx_reading_marks_reading_id;

-- 3c: recommendation_submissions.import_item_id → reading_id
ALTER TABLE public.recommendation_submissions RENAME COLUMN import_item_id TO reading_id;

ALTER INDEX IF EXISTS idx_rec_submissions_import_item RENAME TO idx_rec_submissions_reading_id;

-- ============================================================================
-- Step 4: 重建受列重命名影响的 RPC 函数
-- PostgreSQL 以文本形式存储函数体，RENAME COLUMN 不会更新函数体中的列引用，
-- 必须用 CREATE OR REPLACE FUNCTION 重新解析。
-- ============================================================================

-- 4.1 soft_delete_bookmarks_for_reading（bookmarks.article_id → reading_id）
CREATE OR REPLACE FUNCTION public.soft_delete_bookmarks_for_reading(p_reading_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.bookmarks
  SET deleted_at = now()
  WHERE reading_id = p_reading_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;
END;
$$;

-- 4.2 delete_reading（bookmarks.reading_id + reading_marks.reading_id）
CREATE OR REPLACE FUNCTION public.delete_reading(p_reading_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.bookmarks
  SET deleted_at = now()
  WHERE reading_id = p_reading_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;

  DELETE FROM public.reading_marks
  WHERE reading_id = p_reading_id
    AND user_id = auth.uid();

  UPDATE public.readings
  SET deleted_at = now()
  WHERE id = p_reading_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;
END;
$$;

-- 4.3 check_reading_completed（reading_marks.reading_id）
CREATE OR REPLACE FUNCTION public.check_reading_completed(p_reading_id text, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_completed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'cannot query on behalf of another user';
  END IF;

  SELECT rm.completed INTO v_completed
  FROM public.reading_marks rm
  WHERE rm.reading_id = p_reading_id
    AND rm.user_id = p_user_id;

  RETURN COALESCE(v_completed, false);
END;
$$;

-- 4.4 get_reading_for_recommendation（recommendation_submissions.reading_id）
CREATE OR REPLACE FUNCTION public.get_reading_for_recommendation(p_reading_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', r.id,
    'title', r.title,
    'author', r.author,
    'source_url', r.source_url,
    'sections', r.sections,
    'format', r.format,
    'kind', r.kind
  ) INTO v_result
  FROM public.readings r
  WHERE r.id = p_reading_id
    AND r.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.recommendation_submissions rs
      WHERE rs.reading_id = p_reading_id AND rs.status = 'active'
    );

  RETURN v_result;
END;
$$;

-- ============================================================================
-- Step 5: 刷新 PostgREST schema cache
-- DROP TABLE + RENAME COLUMN 后 PostgREST 的函数/关系缓存可能过期，
-- NOTIFY 触发其重新扫描数据库元数据。
-- ============================================================================
NOTIFY pgrst, 'reload schema';
