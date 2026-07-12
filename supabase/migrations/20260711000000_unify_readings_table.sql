-- ============================================================================
-- Migration: 统一 import_items + articles → readings 单表
-- 日期: 2026-07-11
-- 说明: 合并双表为单表，用 reading_status 枚举驱动状态流转
--       书架区 = WHERE reading_status != 'reading'
--       阅读区 = WHERE reading_status = 'reading'
-- ============================================================================

-- ============================================================================
-- Step 1: 创建 readings 表
-- ============================================================================
CREATE TABLE public.readings (
    id                  text PRIMARY KEY,
    user_id             uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    title               text NOT NULL,
    author              text,
    format              text NOT NULL DEFAULT 'paste',
    cover_url           text,
    lang                text NOT NULL DEFAULT 'auto',
    source_url          text,
    sections            jsonb NOT NULL DEFAULT '[]',
    total_word_count    integer NOT NULL DEFAULT 0,
    section_count       integer NOT NULL DEFAULT 1,
    kind                text NOT NULL DEFAULT 'article' CHECK (kind IN ('article', 'book')),
    reading_status      text NOT NULL DEFAULT 'unread'
                        CHECK (reading_status IN ('unread', 'reading', 'in_progress', 'completed')),
    reading_started_at  timestamptz,
    reading_finished_at timestamptz,
    origin              text NOT NULL DEFAULT 'imported'
                        CHECK (origin IN ('imported', 'shared', 'featured', 'featured_legacy', 'manual')),
    share_status        text NOT NULL DEFAULT 'private'
                        CHECK (share_status IN ('private', 'shared', 'public')),
    share_source_id     text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz,

    UNIQUE (user_id, id)
);

-- ============================================================================
-- Step 2: 创建索引
-- ============================================================================
CREATE INDEX idx_readings_user_id         ON public.readings (user_id);
CREATE INDEX idx_readings_user_created    ON public.readings (user_id, created_at DESC);
CREATE INDEX idx_readings_user_status     ON public.readings (user_id, reading_status);
CREATE INDEX idx_readings_share_source    ON public.readings (share_source_id) WHERE share_source_id IS NOT NULL;
CREATE INDEX idx_readings_deleted         ON public.readings (user_id, deleted_at) WHERE deleted_at IS NOT NULL;

-- ============================================================================
-- Step 3: 迁移 import_items 数据
-- ============================================================================
INSERT INTO public.readings (
    id, user_id, title, author, format, cover_url, lang, source_url,
    sections, total_word_count, section_count, kind,
    origin, share_status, share_source_id,
    created_at, updated_at, deleted_at,
    reading_status
)
SELECT
    id, user_id, title, author, format, cover_url, lang, source_url,
    sections, total_word_count, section_count,
    COALESCE(kind, CASE WHEN format = 'epub' THEN 'book' ELSE 'article' END),
    origin, share_status, share_source_id,
    created_at, updated_at, deleted_at,
    'unread'
FROM public.import_items;

-- ============================================================================
-- Step 4: 迁移 articles 数据
-- ============================================================================

-- 情况 A: article 有 source_import_id → 更新已迁移的 readings 行
-- 使用 DISTINCT ON 选取每个 source_import_id 最新的 article（处理多次取书-还书循环）
WITH latest_article AS (
    SELECT DISTINCT ON (a.source_import_id, a.user_id)
        a.source_import_id,
        a.user_id,
        a.created_at AS article_created_at,
        a.updated_at AS article_updated_at,
        rm.completed,
        rm.paragraph_index,
        rm.progress_percent,
        rm.updated_at AS rm_updated_at
    FROM public.articles a
    LEFT JOIN public.reading_marks rm
        ON rm.article_id = a.id AND rm.user_id = a.user_id
    WHERE a.source_import_id IS NOT NULL
    ORDER BY a.source_import_id, a.user_id, a.created_at DESC
)
UPDATE public.readings r
SET
    reading_status = CASE
        WHEN ai.completed THEN 'completed'
        WHEN ai.paragraph_index IS NOT NULL OR ai.progress_percent > 0 THEN 'in_progress'
        ELSE 'unread'
    END,
    reading_started_at = LEAST(r.created_at, ai.article_created_at),
    reading_finished_at = CASE WHEN ai.completed THEN ai.rm_updated_at ELSE NULL END,
    updated_at = GREATEST(r.updated_at, ai.article_updated_at)
FROM latest_article ai
WHERE r.id = ai.source_import_id
  AND r.user_id = ai.user_id;

-- 情况 B: article 无 source_import_id → 作为独立行插入 readings
INSERT INTO public.readings (
    id, user_id, title, author, format, cover_url, lang, source_url,
    sections, total_word_count, section_count, kind,
    origin, reading_status,
    reading_started_at, reading_finished_at,
    created_at, updated_at, deleted_at
)
SELECT
    a.id, a.user_id, a.title, a.author, a.format, a.cover_url, a.lang, a.source_url,
    a.sections,
    COALESCE(a.word_count, 0),
    a.section_count,
    a.kind,
    'manual',
    CASE
        WHEN rm.completed THEN 'completed'::text
        WHEN rm.paragraph_index IS NOT NULL OR rm.progress_percent > 0 THEN 'in_progress'::text
        ELSE 'unread'::text
    END,
    a.created_at,
    CASE WHEN rm.completed THEN rm.updated_at ELSE NULL END,
    a.created_at, a.updated_at, a.deleted_at
FROM public.articles a
LEFT JOIN public.reading_marks rm
    ON rm.article_id = a.id AND rm.user_id = a.user_id
WHERE a.source_import_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.readings r WHERE r.id = a.id AND r.user_id = a.user_id
  );

-- ============================================================================
-- Step 4b: 临时移除 FK 约束（Step 5 会将 article_id 改为 import_items 的 ID，
--          此时 FK 仍指向 articles 表会导致校验失败，必须先解除）
-- ============================================================================
ALTER TABLE public.bookmarks
  DROP CONSTRAINT IF EXISTS bookmarks_user_article_fk;

ALTER TABLE public.reading_marks
  DROP CONSTRAINT IF EXISTS reading_marks_user_article_fk;

-- ============================================================================
-- Step 5a: reading_marks 预去重（按合并后的目标 ID 分组）
-- 当多个 article 指向同一 source_import_id 时，它们各自的 reading_mark
-- 在后续 Step 5 UPDATE 后会指向同一个 article_id，触发 PK (user_id, article_id) 冲突。
-- 此处先保留每组 (user_id, source_import_id) 中 updated_at 最新的记录。
-- ============================================================================
DELETE FROM public.reading_marks rm
USING public.articles a
WHERE rm.article_id = a.id
  AND a.source_import_id IS NOT NULL
  AND rm.ctid <> (
    SELECT rm2.ctid
    FROM public.reading_marks rm2
    JOIN public.articles a2 ON rm2.article_id = a2.id
    WHERE rm2.user_id = rm.user_id
      AND a2.source_import_id = a.source_import_id
    ORDER BY rm2.updated_at DESC
    LIMIT 1
  );

-- ============================================================================
-- Step 5: 迁移 bookmarks 和 reading_marks 的 FK 引用
-- ============================================================================

-- 情况 A: bookmark/reading_mark 指向的 article 已合并到 readings
UPDATE public.bookmarks b
SET article_id = a.source_import_id
FROM public.articles a
WHERE b.article_id = a.id
  AND a.source_import_id IS NOT NULL;

UPDATE public.reading_marks rm
SET article_id = a.source_import_id
FROM public.articles a
WHERE rm.article_id = a.id
  AND a.source_import_id IS NOT NULL;

-- 情况 B: id 不变（已作为独立 reading 保留），无需额外处理

-- ============================================================================
-- Step 6: 去重 reading_marks（二次保险——清理 Step 5 UPDATE 后可能残留的重复）
-- ============================================================================
DELETE FROM public.reading_marks rm1
USING public.reading_marks rm2
WHERE rm1.user_id = rm2.user_id
  AND rm1.article_id = rm2.article_id
  AND rm1.updated_at < rm2.updated_at;

-- ============================================================================
-- Step 7: 重建 FK 约束（指向 readings 表）
-- ============================================================================

ALTER TABLE public.bookmarks
  ADD CONSTRAINT bookmarks_user_reading_fk
  FOREIGN KEY (user_id, article_id) REFERENCES public.readings(user_id, id) ON DELETE CASCADE;

ALTER TABLE public.reading_marks
  ADD CONSTRAINT reading_marks_user_reading_fk
  FOREIGN KEY (user_id, article_id) REFERENCES public.readings(user_id, id) ON DELETE CASCADE;

-- ============================================================================
-- Step 8: 创建 RPC 函数
-- ============================================================================

-- 8.1 soft_delete_reading（替代 soft_delete_article）
CREATE OR REPLACE FUNCTION public.soft_delete_reading(p_reading_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.readings
  SET deleted_at = now()
  WHERE id = p_reading_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;
END;
$$;

-- 8.2 soft_delete_bookmarks_for_reading（替代 soft_delete_bookmarks_for_article）
CREATE OR REPLACE FUNCTION public.soft_delete_bookmarks_for_reading(p_reading_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.bookmarks
  SET deleted_at = now()
  WHERE article_id = p_reading_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;
END;
$$;

-- 8.3 delete_reading（替代 delete_import_item —— 单表软删除 + 级联清理）
CREATE OR REPLACE FUNCTION public.delete_reading(p_reading_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 软删除关联 bookmarks
  UPDATE public.bookmarks
  SET deleted_at = now()
  WHERE article_id = p_reading_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;

  -- 清除 reading_mark
  DELETE FROM public.reading_marks
  WHERE article_id = p_reading_id
    AND user_id = auth.uid();

  -- 软删除 reading
  UPDATE public.readings
  SET deleted_at = now()
  WHERE id = p_reading_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;
END;
$$;

-- 8.4 check_reading_completed（替代 check_import_item_reading_completed）
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
  WHERE rm.article_id = p_reading_id
    AND rm.user_id = p_user_id;

  RETURN COALESCE(v_completed, false);
END;
$$;

-- 8.5 get_reading_for_recommendation（替代 get_import_item_for_recommendation）
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
      WHERE rs.import_item_id = p_reading_id AND rs.status = 'active'
    );

  RETURN v_result;
END;
$$;

-- 8.6 increment_recommendation_add_count（查询源改为 readings）
-- p_user_id 为旧版签名兼容保留，函数内部不使用
CREATE OR REPLACE FUNCTION public.increment_recommendation_add_count(
  p_submission_id text,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_add_count integer;
BEGIN
  SELECT COUNT(DISTINCT user_id) INTO v_add_count
  FROM public.readings
  WHERE share_source_id = p_submission_id
    AND origin IN ('featured', 'featured_legacy')
    AND deleted_at IS NULL;

  UPDATE public.recommendation_submissions
  SET add_count = v_add_count,
      recommend_score = public.compute_recommendation_score(p_submission_id),
      updated_at = now()
  WHERE id = p_submission_id AND status = 'active';
END;
$$;

-- 8.7 start_reading（新增 —— 阅读区上限原子检查）
CREATE OR REPLACE FUNCTION public.start_reading(
  p_reading_id text,
  p_user_id uuid,
  p_max_limit integer DEFAULT 5
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active_count integer;
BEGIN
  -- SECURITY DEFINER 绕过 RLS，必须显式校验调用者身份
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'cannot act on behalf of another user';
  END IF;

  SELECT COUNT(*) INTO v_active_count
  FROM (
    SELECT 1 FROM public.readings
    WHERE user_id = p_user_id AND reading_status = 'reading' AND deleted_at IS NULL
    FOR UPDATE
  ) AS locked;

  IF v_active_count >= p_max_limit THEN
    RAISE EXCEPTION '阅读区已满（上限 % 本），请先放回一本书', p_max_limit;
  END IF;

  UPDATE public.readings
  SET reading_status = 'reading',
      reading_started_at = COALESCE(reading_started_at, now()),
      updated_at = now()
  WHERE id = p_reading_id
    AND user_id = p_user_id
    AND reading_status != 'reading'
    AND deleted_at IS NULL;
END;
$$;

-- ============================================================================
-- Step 8b: GRANT EXECUTE 授权
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.soft_delete_reading(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_bookmarks_for_reading(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_reading(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_reading_completed(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reading_for_recommendation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_reading(text, uuid, integer) TO authenticated;
-- increment_recommendation_add_count(text, uuid) 签名未变，GRANT 已存在

-- ============================================================================
-- Step 9: 建立 RLS 策略
-- ============================================================================
ALTER TABLE public.readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY readings_select_own ON public.readings
  FOR SELECT USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY readings_insert_own ON public.readings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY readings_update_own ON public.readings
  FOR UPDATE USING (auth.uid() = user_id AND deleted_at IS NULL);

-- DELETE 禁止直接删除，通过 RPC 软删除

-- ============================================================================
-- Step 10: 创建触发器
-- ============================================================================
CREATE TRIGGER trg_readings_set_updated_at
  BEFORE UPDATE ON public.readings
  FOR EACH ROW EXECUTE FUNCTION public.set_record_updated_at();
