-- 内容形态字段（article / book / podcast 等）
-- 与 format（导入方式）和 origin（来源渠道）正交

-- import_items
ALTER TABLE public.import_items ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'article';
ALTER TABLE public.import_items DROP CONSTRAINT IF EXISTS import_items_kind_check;
ALTER TABLE public.import_items ADD CONSTRAINT import_items_kind_check CHECK (kind IN ('article', 'book'));

-- articles
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'article';
ALTER TABLE public.articles DROP CONSTRAINT IF EXISTS articles_kind_check;
ALTER TABLE public.articles ADD CONSTRAINT articles_kind_check CHECK (kind IN ('article', 'book'));
