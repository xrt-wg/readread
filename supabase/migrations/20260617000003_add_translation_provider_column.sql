-- 为 bookmarks 表添加 translation_provider 列，记录实际调用的翻译服务
alter table public.bookmarks
  add column if not exists translation_provider text;
