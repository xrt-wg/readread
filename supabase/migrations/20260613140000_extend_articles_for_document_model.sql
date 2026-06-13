-- 统一文档对象模型 — 数据库 schema 扩展
-- Phase 0 / 任务 0.3
-- 新增字段：articles, bookmarks, reading_marks
-- 含现有数据回填 + CHECK 约束

-- ═══════════════════════════════════════════════════════════
-- 1. articles 表
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS author text,
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'paste',
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS lang text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS sections jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS section_count integer NOT NULL DEFAULT 1;

-- source_url 保留不解构（已存在，不做变更）

-- CHECK 约束
ALTER TABLE public.articles
  ADD CONSTRAINT articles_sections_is_array
  CHECK (jsonb_typeof(sections) = 'array');

ALTER TABLE public.articles
  ADD CONSTRAINT articles_section_count_check
  CHECK (section_count >= 1);

-- 现有数据回填：将旧 text + markdown 包装为单 section Document
UPDATE public.articles
SET format = 'paste',
    sections = jsonb_build_array(
      jsonb_build_object(
        'id', 's_main',
        'heading', null,
        'depth', 0,
        'parentId', null,
        'order', 0,
        'body', jsonb_build_object(
          'text', COALESCE(text, ''),
          'markdown', markdown,
          'wordCount', COALESCE(word_count, 0)
        )
      )
    ),
    section_count = 1
WHERE sections = '[]' OR sections IS NULL;

-- ═══════════════════════════════════════════════════════════
-- 2. bookmarks 表
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.bookmarks
  ADD COLUMN IF NOT EXISTS section_id text,
  ADD COLUMN IF NOT EXISTS section_heading text;

-- ═══════════════════════════════════════════════════════════
-- 3. reading_marks 表
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.reading_marks
  ADD COLUMN IF NOT EXISTS section_id text,
  ADD COLUMN IF NOT EXISTS completed_sections text[] DEFAULT '{}';
