-- 导入区与阅读区 — import_items 表
-- Phase 0 / 任务 0.1 + 0.4
-- 含 CREATE TABLE + 约束 + 索引 + RLS + GRANT + 触发器 + UNIQUE

-- ═══════════════════════════════════════════════════════════
-- 1. 建表
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.import_items (
  id                text PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES public.profiles(user_id),

  -- 内容（复用 Document 模型字段）
  title             text NOT NULL,
  author            text,
  format            text NOT NULL,
  cover_url         text,
  lang              text NOT NULL DEFAULT 'auto',
  source_url        text,
  sections          jsonb NOT NULL DEFAULT '[]',
  total_word_count  integer NOT NULL DEFAULT 0,
  section_count     integer NOT NULL DEFAULT 1,

  -- 来源 + 共享（远期共享池预留）
  origin            text NOT NULL DEFAULT 'imported',
  share_status      text NOT NULL DEFAULT 'private',
  share_source_id   text,

  -- 时间戳
  created_at        timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at        timestamptz NOT NULL DEFAULT timezone('utc', now()),
  deleted_at        timestamptz
);

-- ═══════════════════════════════════════════════════════════
-- 2. CHECK 约束
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.import_items
  ADD CONSTRAINT import_items_origin_check
  CHECK (origin IN ('imported', 'shared'));

ALTER TABLE public.import_items
  ADD CONSTRAINT import_items_share_status_check
  CHECK (share_status IN ('private', 'shared', 'public'));

ALTER TABLE public.import_items
  ADD CONSTRAINT import_items_sections_is_array
  CHECK (jsonb_typeof(sections) = 'array');

ALTER TABLE public.import_items
  ADD CONSTRAINT import_items_section_count_check
  CHECK (section_count >= 1);

ALTER TABLE public.import_items
  ADD CONSTRAINT import_items_user_id_id_unique
  UNIQUE (user_id, id);

-- ═══════════════════════════════════════════════════════════
-- 3. 索引
-- ═══════════════════════════════════════════════════════════

-- 用户素材列表（按创建时间倒序）
CREATE INDEX IF NOT EXISTS idx_import_items_user_created
  ON public.import_items (user_id, created_at DESC);

-- 用户素材列表（排除已删除）
CREATE INDEX IF NOT EXISTS idx_import_items_user_active
  ON public.import_items (user_id, deleted_at);

-- 共享池查询
CREATE INDEX IF NOT EXISTS idx_import_items_shared
  ON public.import_items (share_status, deleted_at)
  WHERE share_status IN ('shared', 'public');

-- 溯源查询
CREATE INDEX IF NOT EXISTS idx_import_items_share_source
  ON public.import_items (share_source_id)
  WHERE share_source_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- 4. 自动触发器（updated_at）
-- ═══════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_import_items_set_updated_at ON public.import_items;
CREATE TRIGGER trg_import_items_set_updated_at
  BEFORE UPDATE ON public.import_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_record_updated_at();

-- ═══════════════════════════════════════════════════════════
-- 5. RLS 策略
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.import_items ENABLE ROW LEVEL SECURITY;

-- 用户只能读写自己的素材
CREATE POLICY "Users can view own import items"
  ON public.import_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own import items"
  ON public.import_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own import items"
  ON public.import_items FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 不授权 DELETE 策略——软删除通过 RPC 函数 delete_import_item 原子执行
-- 与现有 articles 惯例一致（删除通过 soft_delete_article RPC）

-- ═══════════════════════════════════════════════════════════
-- 6. 权限授予
-- ═══════════════════════════════════════════════════════════

-- 仅授予 SELECT / INSERT / UPDATE，不授予 DELETE
GRANT SELECT, INSERT, UPDATE ON public.import_items TO authenticated;
