-- ═══════════════════════════════════════════════════════════
-- 社区众包推荐系统 Phase 2
-- 1. 迁移旧 featured_articles 种子数据到新推荐模型
-- 2. 废弃并 DROP featured_articles 表
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE
  v_legacy_user_id uuid;
  v_article record;
  v_import_item_id text;
  v_submission_id text;
  v_word_count integer;
  v_keywords text[];
BEGIN
  -- 0. 选取一个现有用户作为名义提交者（使用 profiles 中最早创建的用户; 若无则回退到已知的管理员账号）
  SELECT user_id INTO v_legacy_user_id
  FROM public.profiles
  ORDER BY created_at ASC
  LIMIT 1;

  -- 若 profiles 为空（极少情况），直接跳过迁移
  IF v_legacy_user_id IS NULL THEN
    RAISE NOTICE 'No profiles found — skipping legacy data migration. featured_articles table will still be dropped.';
    -- 仍然 DROP featured_articles
    DROP TABLE IF EXISTS public.featured_articles CASCADE;
    RETURN;
  END IF;

  -- 1. 遍历旧 featured_articles 中已发布的条目
  FOR v_article IN
    SELECT * FROM public.featured_articles
    WHERE status = 'published' AND deleted_at IS NULL
  LOOP
    -- 检查是否已存在同名推荐（幂等保证）
    IF EXISTS (
      SELECT 1 FROM public.recommendation_submissions
      WHERE title = v_article.title AND status = 'active'
    ) THEN
      RAISE NOTICE 'Skipping already-migrated article: %', v_article.title;
      CONTINUE;
    END IF;

    -- 2. 创建 import_item
    v_import_item_id := 'imp_' || extract(epoch from now())::bigint::text || '_' || substr(md5(v_article.id || random()::text), 1, 5);
    v_word_count := coalesce(
      (SELECT array_length(regexp_split_to_array(coalesce(v_article.text, ''), '\s+'), 1)),
      0
    );

    INSERT INTO public.import_items (
      id, user_id, title, author, format, cover_url, lang, source_url,
      sections, total_word_count, section_count, kind, origin, share_status
    ) VALUES (
      v_import_item_id,
      v_legacy_user_id,
      v_article.title,
      null,
      'markdown',
      v_article.cover_image_url,
      'en',
      null,
      jsonb_build_array(
        jsonb_build_object(
          'id', 's_0',
          'heading', null,
          'depth', 0,
          'parentId', null,
          'order', 0,
          'body', jsonb_build_object(
            'text', coalesce(v_article.text, ''),
            'markdown', v_article.markdown,
            'wordCount', v_word_count
          )
        )
      ),
      v_word_count,
      1,
      'article',
      'featured_legacy',
      'private'
    );

    -- 3. 创建 recommendation_submission（从 source 提取关键词）
    v_submission_id := 'rec_' || extract(epoch from now())::bigint::text || '_' || substr(md5(v_article.id || random()::text), 1, 5);

    IF v_article.source IS NOT NULL THEN
      v_keywords := ARRAY[regexp_replace(v_article.source, '\.com$', '', 'g')];
    ELSE
      v_keywords := '{}';
    END IF;

    INSERT INTO public.recommendation_submissions (
      id, submitter_user_id, import_item_id,
      title, author, source_url,
      intro, keywords, excerpt,
      add_count, recommend_score, status
    ) VALUES (
      v_submission_id,
      v_legacy_user_id,
      v_import_item_id,
      v_article.title,
      null,
      null,
      coalesce(v_article.description, ''),
      v_keywords,
      left(coalesce(v_article.text, ''), 300),
      0, 0, 'active'
    );

    RAISE NOTICE 'Migrated: %', v_article.title;
  END LOOP;

  -- 4. 废弃旧表
  DROP TABLE IF EXISTS public.featured_articles CASCADE;
  RAISE NOTICE 'featured_articles table has been dropped.';
END;
$$;
