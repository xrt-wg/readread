-- ============================================================================
-- 测试数据脚本：阅读区书架区数据模型统一 migration 验证
-- 日期: 2026-07-11
-- 用途: 在本地/staging 数据库中插入模拟数据，覆盖所有迁移边界场景
-- 注意: 此文件不是 migration，是手动执行的测试脚本
--       执行前需确保 profiles 表中存在 test_user_a 和 test_user_b
-- ============================================================================

-- 假设两个测试用户的 profile 已存在
-- user_a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
-- user_b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

DO $$
DECLARE
  user_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  user_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  imp_id_1 text := 'imp_test_001';
  imp_id_2 text := 'imp_test_002';
  imp_id_3 text := 'imp_test_003_shared';
  imp_id_4 text := 'imp_test_004_softdeleted';
  art_id_1a text := 'doc_test_001_first';
  art_id_1b text := 'doc_test_001_second';
  art_id_2 text := 'doc_test_002';
  art_id_3 text := 'doc_test_003_softdeleted';
  art_id_4 text := 'doc_test_004_orphan_rm';
BEGIN

  -- ==========================================================================
  -- 场景 1: 同一 import_item 有多个 article（多次取书-还书循环）
  -- ==========================================================================
  -- import_item: 用户 A 的一本书，被两次"移入阅读区"
  INSERT INTO public.import_items (id, user_id, title, author, format, cover_url, lang, source_url, sections, total_word_count, section_count, kind, origin, share_status, created_at, updated_at)
  VALUES (imp_id_1, user_a, '测试书-多次取书', '作者A', 'epub', NULL, 'auto', NULL,
          '[{"id":"s_0","heading":"第一章","depth":0,"order":0,"body":{"text":"第一章内容。","markdown":"第一章内容。","wordCount":5}}]'::jsonb,
          5, 1, 'book', 'imported', 'private', now() - interval '7 days', now() - interval '1 day');

  -- 第一次取书（较早，进度少）
  INSERT INTO public.articles (id, user_id, title, text, markdown, word_count, source_type, format, lang, sections, section_count, kind, source_import_id, imported_at, created_at, updated_at)
  VALUES (art_id_1a, user_a, '测试书-多次取书', '第一章内容。', '第一章内容。', 5, 'manual', 'epub', 'auto',
          '[{"id":"s_0","heading":"第一章","depth":0,"order":0,"body":{"text":"第一章内容。","markdown":"第一章内容。","wordCount":5}}]'::jsonb,
          1, 'book', imp_id_1, now() - interval '5 days', now() - interval '5 days', now() - interval '5 days');

  INSERT INTO public.reading_marks (user_id, article_id, paragraph_index, completed, section_id, completed_sections, progress_percent, created_at, updated_at)
  VALUES (user_a, art_id_1a, 1, false, 's_0', '{}', 20, now() - interval '5 days', now() - interval '5 days');

  -- 第二次取书（较新，进度更多——应保留此状态）
  INSERT INTO public.articles (id, user_id, title, text, markdown, word_count, source_type, format, lang, sections, section_count, kind, source_import_id, imported_at, created_at, updated_at)
  VALUES (art_id_1b, user_a, '测试书-多次取书', '第一章内容。', '第一章内容。', 5, 'manual', 'epub', 'auto',
          '[{"id":"s_0","heading":"第一章","depth":0,"order":0,"body":{"text":"第一章内容。","markdown":"第一章内容。","wordCount":5}}]'::jsonb,
          1, 'book', imp_id_1, now() - interval '2 days', now() - interval '2 days', now() - interval '2 days');

  INSERT INTO public.reading_marks (user_id, article_id, paragraph_index, completed, section_id, completed_sections, progress_percent, created_at, updated_at)
  VALUES (user_a, art_id_1b, 3, false, 's_0', '{}', 60, now() - interval '2 days', now() - interval '1 day');

  -- 第二次取书还产生了书签
  INSERT INTO public.bookmarks (id, user_id, article_id, type, text, translation, translation_status, paragraph_index, char_offset, section_id, review_count, familiarity, created_at, updated_at)
  VALUES ('bm_test_001', user_a, art_id_1b, 'word', '测试词汇', 'test word', 'done', 3, 5, 's_0', 1, 2, now() - interval '1 day', now() - interval '1 day');

  -- ==========================================================================
  -- 场景 5: kind 为 NULL 的历史 import_item
  -- ==========================================================================
  -- 直接在数据库中插入 kind=NULL 的记录（模拟 DEFAULT 设置前的旧数据）
  INSERT INTO public.import_items (id, user_id, title, author, format, cover_url, lang, source_url, sections, total_word_count, section_count, origin, share_status, created_at, updated_at)
  VALUES (imp_id_2, user_a, 'Kind为NULL的旧数据', '作者B', 'url', NULL, 'auto', 'https://example.com',
          '[{"id":"s_main","heading":null,"depth":0,"order":0,"body":{"text":"旧数据正文。","markdown":"旧数据正文。","wordCount":3}}]'::jsonb,
          3, 1, 'imported', 'private', now() - interval '30 days', now() - interval '30 days');

  -- 需要手动将 kind 设为 NULL（绕过 DEFAULT 约束...实际上数据库 DEFAULT 会阻止 NULL）
  -- 此场景用于验证 COALESCE fallback 逻辑，在迁移后 kind 应被设为默认值
  -- 将 format 从 url 改为 epub 后再跑 migration，验证 COALESCE 是否将 kind 推断为 'book'
  UPDATE public.import_items SET kind = NULL WHERE id = imp_id_2;

  -- 关联的 article
  INSERT INTO public.articles (id, user_id, title, text, markdown, word_count, source_type, format, lang, sections, section_count, kind, source_import_id, imported_at, created_at, updated_at)
  VALUES (art_id_2, user_a, 'Kind为NULL的旧数据', '旧数据正文。', '旧数据正文。', 3, 'manual', 'url', 'auto',
          '[{"id":"s_main","heading":null,"depth":0,"order":0,"body":{"text":"旧数据正文。","markdown":"旧数据正文。","wordCount":3}}]'::jsonb,
          1, 'article', imp_id_2, now() - interval '28 days', now() - interval '30 days', now() - interval '28 days');

  -- ==========================================================================
  -- 场景 4: 用户 A 的 article 指向用户 B 的 import_item（共享推荐场景）
  -- ==========================================================================
  -- 用户 B 有一个 import_item（原始提交者的内容）
  INSERT INTO public.import_items (id, user_id, title, author, format, cover_url, lang, source_url, sections, total_word_count, section_count, kind, origin, share_status, share_source_id, created_at, updated_at)
  VALUES (imp_id_3, user_b, '共享推荐的书', '作者C', 'epub', NULL, 'auto', NULL,
          '[{"id":"s_0","heading":"推荐内容","depth":0,"order":0,"body":{"text":"这是被推荐的内容。","markdown":"这是被推荐的内容。","wordCount":6}}]'::jsonb,
          6, 1, 'book', 'featured', 'shared', 'rec_submission_001', now() - interval '10 days', now() - interval '10 days');

  -- 用户 A 有一个 article（从推荐添加的），source_import_id 指向用户 B 的 import_item
  INSERT INTO public.import_items (id, user_id, title, author, format, cover_url, lang, source_url, sections, total_word_count, section_count, kind, origin, share_status, share_source_id, created_at, updated_at)
  VALUES (imp_id_3 || '_a', user_a, '共享推荐的书', '作者C', 'epub', NULL, 'auto', NULL,
          '[{"id":"s_0","heading":"推荐内容","depth":0,"order":0,"body":{"text":"这是被推荐的内容。","markdown":"这是被推荐的内容。","wordCount":6}}]'::jsonb,
          6, 1, 'book', 'featured', 'private', 'rec_submission_001', now() - interval '8 days', now() - interval '8 days');

  INSERT INTO public.articles (id, user_id, title, text, markdown, word_count, source_type, format, lang, sections, section_count, kind, source_import_id, imported_at, created_at, updated_at)
  VALUES (art_id_3, user_a, '共享推荐的书', '这是被推荐的内容。', '这是被推荐的内容。', 6, 'manual', 'epub', 'auto',
          '[{"id":"s_0","heading":"推荐内容","depth":0,"order":0,"body":{"text":"这是被推荐的内容。","markdown":"这是被推荐的内容。","wordCount":6}}]'::jsonb,
          1, 'book', imp_id_3 || '_a', now() - interval '7 days', now() - interval '8 days', now() - interval '3 days');

  -- 用户 A 读完了这本书
  INSERT INTO public.reading_marks (user_id, article_id, paragraph_index, completed, section_id, completed_sections, progress_percent, created_at, updated_at)
  VALUES (user_a, art_id_3, 0, true, 's_0', '{s_0}', 100, now() - interval '7 days', now() - interval '3 days');

  -- ==========================================================================
  -- 场景 6: 软删除的 import_item 带有关联的 bookmarks
  -- ==========================================================================
  INSERT INTO public.import_items (id, user_id, title, author, format, cover_url, lang, source_url, sections, total_word_count, section_count, kind, origin, share_status, created_at, updated_at, deleted_at)
  VALUES (imp_id_4, user_a, '已删除的书', '作者D', 'epub', NULL, 'auto', NULL,
          '[{"id":"s_0","heading":"第一章","depth":0,"order":0,"body":{"text":"被删除的内容。","markdown":"被删除的内容。","wordCount":4}}]'::jsonb,
          4, 1, 'book', 'imported', 'private', now() - interval '20 days', now() - interval '10 days', now() - interval '10 days');

  -- 关联的 article（也软删除了）
  INSERT INTO public.articles (id, user_id, title, text, markdown, word_count, source_type, format, lang, sections, section_count, kind, source_import_id, imported_at, created_at, updated_at, deleted_at)
  VALUES (art_id_4, user_a, '已删除的书', '被删除的内容。', '被删除的内容。', 4, 'manual', 'epub', 'auto',
          '[{"id":"s_0","heading":"第一章","depth":0,"order":0,"body":{"text":"被删除的内容。","markdown":"被删除的内容。","wordCount":4}}]'::jsonb,
          1, 'book', imp_id_4, now() - interval '15 days', now() - interval '20 days', now() - interval '10 days', now() - interval '10 days');

  -- 用户 A 在这本书上有书签（书签本身未软删除）
  INSERT INTO public.bookmarks (id, user_id, article_id, type, text, translation, translation_status, paragraph_index, char_offset, section_id, review_count, familiarity, created_at, updated_at)
  VALUES ('bm_test_004', user_a, art_id_4, 'sentence', '被删除内容中的标记', 'marked in deleted content', 'done', 1, 0, 's_0', 0, 0, now() - interval '15 days', now() - interval '15 days');

  -- ==========================================================================
  -- 场景 2 & 3: bookmark/reading_mark 的 article 已被软删除但 bookmark/reading_mark 未删除
  -- ==========================================================================
  -- 场景 2: 软删除的 article 上的 bookmark（bookmark 自身未软删除）
  -- art_id_4 已软删除，bm_test_004 是它的 bookmark - 已包含在场景 6 中

  -- 场景 3: reading_marks 存在但 article 已软删除
  -- art_id_4 已软删除，但 reading_mark 仍存在
  INSERT INTO public.reading_marks (user_id, article_id, paragraph_index, completed, section_id, completed_sections, progress_percent, created_at, updated_at)
  VALUES (user_a, art_id_4, 2, false, 's_0', '{}', 50, now() - interval '15 days', now() - interval '11 days');

END $$;
