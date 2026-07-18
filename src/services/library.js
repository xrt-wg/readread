import { articleStore, bookmarkStore, exportData, importData, readingMarkStore } from '../store/storage'
import { getSupabaseClient } from './supabase'
import { getSession } from './supabase/auth'
import { isLibraryAccessError, resolveLibraryErrorMessage } from './errorUtils'
import { isDue, shuffleArray } from '../utils/reviewUtils'

const ARTICLE_COLUMNS = 'id, user_id, title, text, markdown, word_count, source_type, source_url, author, format, cover_url, lang, sections, section_count, kind, source_import_id, imported_at, created_at, updated_at, deleted_at'
const IMPORT_ITEM_COLUMNS = 'id, user_id, title, author, format, cover_url, lang, source_url, sections, total_word_count, section_count, origin, share_status, share_source_id, created_at, updated_at, deleted_at'
const BOOKMARK_COLUMNS = 'id, user_id, article_id, type, text, translation, translation_provider, context_sentence, context_translation, translation_status, paragraph_index, char_offset, review_count, next_review_at, familiarity, section_id, section_heading, created_at, updated_at, deleted_at'
const READING_MARK_COLUMNS = 'user_id, article_id, paragraph_index, completed, section_id, completed_sections, progress_percent, created_at, updated_at'

function useCloudSource({ canUseCloudLibrary, userId }) {
  return Boolean(canUseCloudLibrary && userId)
}

function mapArticleRow(row) {
  return {
    // 旧字段（保持现有调用方兼容）
    id: row.id,
    title: row.title,
    text: row.text,
    markdown: row.markdown,
    wordCount: row.word_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    // 新字段（Document 模型扩展）
    author: row.author,
    format: row.format || 'paste',
    coverUrl: row.cover_url,
    lang: row.lang || 'auto',
    sections: row.sections,
    sectionCount: row.section_count || 1,
    kind: row.kind || 'article',
    // 书架溯源（可空）
    sourceImportId: row.source_import_id ?? null,
    importedAt: row.imported_at ?? null,
  }
}

function mapBookmarkRow(row) {
  return {
    id: row.id,
    type: row.type,
    text: row.text,
    translation: row.translation,
    translationProvider: row.translation_provider ?? null,
    contextSentence: row.context_sentence,
    contextTranslation: row.context_translation,
    translationStatus: row.translation_status,
    articleId: row.article_id,
    paragraphIndex: row.paragraph_index,
    charOffset: row.char_offset,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewCount: row.review_count,
    nextReviewAt: row.next_review_at,
    familiarity: row.familiarity,
    // 新字段（Document 模型扩展）
    sectionId: row.section_id,
    sectionHeading: row.section_heading,
  }
}

function mapReadingMarkRow(row) {
  if (!row) {
    return null
  }

  if (row.paragraph_index === null && row.completed === false) {
    return null
  }

  return {
    articleId: row.article_id,
    paragraphIndex: row.paragraph_index,
    completed: row.completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // 新字段（Document 模型扩展）
    sectionId: row.section_id,
    completedSections: row.completed_sections || [],
    progressPercent: row.progress_percent,
  }
}

function mapReadingMarks(rows) {
  return rows.reduce((accumulator, row) => {
    const mark = mapReadingMarkRow(row)

    if (mark) {
      accumulator[mark.articleId] = mark
    }

    return accumulator
  }, {})
}

function assertImportData(data) {
  if (
    !data ||
    ![1, 2].includes(data.version) ||
    !Array.isArray(data.articles) ||
    !Array.isArray(data.bookmarks) ||
    (data.readingMarks && typeof data.readingMarks !== 'object')
  ) {
    throw new Error('无效的备份文件格式')
  }
}

async function fetchCloudReadingMarkRow(articleId, userId) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('reading_marks')
    .select(READING_MARK_COLUMNS)
    .eq('user_id', userId)
    .eq('article_id', articleId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function saveCloudReadingMarkRecord(record, userId) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('reading_marks')
    .upsert(
      {
        user_id: userId,
        article_id: record.articleId,
        paragraph_index: record.paragraphIndex ?? null,
        completed: Boolean(record.completed),
        section_id: record.sectionId ?? null,
        completed_sections: record.completedSections ?? [],
        progress_percent: record.progressPercent ?? null,
        created_at: record.createdAt ?? new Date().toISOString(),
        updated_at: record.updatedAt ?? new Date().toISOString(),
      },
      {
        onConflict: 'user_id,article_id',
        ignoreDuplicates: false,
      }
    )
    .select(READING_MARK_COLUMNS)
    .single()

  if (error) {
    throw error
  }

  return mapReadingMarkRow(data)
}

export async function listArticles(options) {
  if (!useCloudSource(options)) {
    return articleStore.getAll()
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('articles')
    .select(ARTICLE_COLUMNS)
    .eq('user_id', options.userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return data.map(mapArticleRow)
}

export async function saveArticle(article, options) {
  if (!useCloudSource(options)) {
    return articleStore.save(article)
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('articles')
    .upsert(
      {
        id: article.id,
        user_id: options.userId,
        title: article.title,
        text: article.text,
        markdown: article.markdown ?? null,
        word_count: article.wordCount ?? article.text?.split(/\s+/).filter(Boolean).length ?? 0,
        source_type: article.sourceType ?? 'manual',
        source_url: article.sourceUrl ?? null,
        author: article.author ?? null,
        format: article.format ?? 'paste',
        cover_url: article.coverUrl ?? null,
        lang: article.lang ?? 'auto',
        sections: article.sections ?? [],
        section_count: article.sectionCount ?? 1,
        kind: article.kind ?? 'article',
        source_import_id: article.source_import_id ?? null,
        imported_at: article.imported_at ?? null,
        deleted_at: null,
      },
      {
        onConflict: 'id',
        ignoreDuplicates: false,
      }
    )
    .select(ARTICLE_COLUMNS)
    .single()

  if (error) {
    throw error
  }

  return mapArticleRow(data)
}

async function executeCloudDelete(articleId, userId) {
  const client = getSupabaseClient()
  const now = new Date().toISOString()

  const [{ error: articleError }, { error: bookmarkError }, { error: readingMarkError }] = await Promise.all([
    client
      .rpc('soft_delete_article', { article_id: articleId }),
    client
      .rpc('soft_delete_bookmarks_for_article', { p_article_id: articleId }),
    client
      .from('reading_marks')
      .upsert(
        {
          user_id: userId,
          article_id: articleId,
          paragraph_index: null,
          completed: false,
          updated_at: now,
        },
        {
          onConflict: 'user_id,article_id',
          ignoreDuplicates: false,
        }
      ),
  ])

  return { articleError, bookmarkError, readingMarkError }
}

function throwIfError({ articleError, bookmarkError, readingMarkError }) {
  if (articleError) throw articleError
  if (bookmarkError) throw bookmarkError
  if (readingMarkError) throw readingMarkError
}

export async function deleteArticle(articleId, options) {
  if (!useCloudSource(options)) {
    articleStore.delete(articleId)
    return
  }

  const userId = options.userId

  // 首次尝试
  const result = await executeCloudDelete(articleId, userId)

  // 403 表示 Supabase 客户端 JWT 可能未就绪，强制刷新 session 后重试一次
  if (isLibraryAccessError(result.articleError) || isLibraryAccessError(result.bookmarkError) || isLibraryAccessError(result.readingMarkError)) {
    try {
      await getSession()
    } catch (_) {
      // session 刷新失败则直接抛出原始错误
      throwIfError(result)
      return
    }

    const retryResult = await executeCloudDelete(articleId, userId)
    throwIfError(retryResult)
    return
  }

  throwIfError(result)
}

export async function listBookmarksByArticle(articleId, options) {
  if (!useCloudSource(options)) {
    return bookmarkStore.getByArticle(articleId)
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('bookmarks')
    .select(BOOKMARK_COLUMNS)
    .eq('user_id', options.userId)
    .eq('article_id', articleId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return data.map(mapBookmarkRow)
}

export async function listAllBookmarks(options) {
  if (!useCloudSource(options)) {
    return bookmarkStore.getAll()
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('bookmarks')
    .select(BOOKMARK_COLUMNS)
    .eq('user_id', options.userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  const bookmarks = data.map(mapBookmarkRow)

  // 客户端 join articles 获取标题（复合 FK 无法用 PostgREST 自动 join）
  const articleIds = [...new Set(bookmarks.map(b => b.articleId).filter(Boolean))]
  if (articleIds.length > 0) {
    const { data: articles } = await client
      .from('articles')
      .select('id, title')
      .eq('user_id', options.userId)
      .in('id', articleIds)

    if (articles) {
      const titleMap = {}
      for (const a of articles) {
        titleMap[a.id] = a.title
      }
      for (const bm of bookmarks) {
        bm.articleTitle = titleMap[bm.articleId] ?? null
      }
    }
  }

  return bookmarks
}

export async function listDueBookmarks(options, excludeIds = new Set()) {
  const all = await listAllBookmarks(options)
  const now = Date.now()

  const newCards = []       // reviewCount === 0
  const dueCards = []       // isDue = true 且 reviewCount > 0
  const futureCards = []    // isDue = false

  for (const bm of all) {
    if (excludeIds.has(bm.id)) continue  // 排除本轮已评价卡片
    if (!bm.reviewCount || bm.reviewCount === 0) {
      newCards.push(bm)
    } else if (isDue(bm, now)) {
      dueCards.push(bm)
    } else {
      futureCards.push(bm)
    }
  }

  // 到期卡片按到期时间排序（最早的优先），无 nextReviewAt 的异常卡片排在最前
  dueCards.sort((a, b) => {
    if (!a.nextReviewAt) return -1
    if (!b.nextReviewAt) return 1
    return new Date(a.nextReviewAt).getTime() - new Date(b.nextReviewAt).getTime()
  })

  // 组卷：到期优先 + 新卡片补足，上限 10
  const pool = [...dueCards, ...newCards]
  const session = pool.slice(0, 10)

  // 不足 10 张时从未来池随机补齐
  if (session.length < 10 && futureCards.length > 0) {
    const fill = shuffleArray(futureCards).slice(0, 10 - session.length)
    session.push(...fill)
  }

  // 最终 shuffle 仅改变展示顺序，不影响哪些卡片进入本轮（已在 slice 阶段确定）
  return shuffleArray(session)
}

export async function saveBookmark(bookmark, options) {
  if (!useCloudSource(options)) {
    return bookmarkStore.save(bookmark)
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('bookmarks')
    .upsert(
      {
        id: bookmark.id,
        user_id: options.userId,
        article_id: bookmark.articleId,
        type: bookmark.type,
        text: bookmark.text,
        translation: bookmark.translation ?? null,
        translation_provider: bookmark.translationProvider ?? null,
        context_sentence: bookmark.contextSentence ?? null,
        context_translation: bookmark.contextTranslation ?? null,
        translation_status: bookmark.translationStatus ?? 'pending',
        paragraph_index: bookmark.paragraphIndex ?? null,
        char_offset: bookmark.charOffset ?? null,
        review_count: bookmark.reviewCount ?? 0,
        next_review_at: bookmark.nextReviewAt ?? null,
        familiarity: bookmark.familiarity ?? 0,
        section_id: bookmark.sectionId ?? null,
        section_heading: bookmark.sectionHeading ?? null,
        deleted_at: null,
      },
      {
        onConflict: 'id',
        ignoreDuplicates: false,
      }
    )
    .select(BOOKMARK_COLUMNS)
    .single()

  if (error) {
    throw error
  }

  return mapBookmarkRow(data)
}

export async function deleteBookmark(bookmarkId, options) {
  if (!useCloudSource(options)) {
    bookmarkStore.delete(bookmarkId)
    return
  }

  const client = getSupabaseClient()
  const { error } = await client
    .from('bookmarks')
    .update({ deleted_at: new Date().toISOString() })
    .eq('user_id', options.userId)
    .eq('id', bookmarkId)
    .is('deleted_at', null)

  if (error) {
    throw error
  }
}

export async function getReadingMark(articleId, options) {
  if (!useCloudSource(options)) {
    return readingMarkStore.get(articleId)
  }

  const row = await fetchCloudReadingMarkRow(articleId, options.userId)
  return mapReadingMarkRow(row)
}

export async function listReadingMarks(options) {
  if (!useCloudSource(options)) {
    return readingMarkStore.getAll()
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('reading_marks')
    .select(READING_MARK_COLUMNS)
    .eq('user_id', options.userId)

  if (error) {
    throw error
  }

  return mapReadingMarks(data)
}

export async function saveReadingMark(articleId, paragraphIndex, options, sectionId = null, progressPercent = null) {
  if (!useCloudSource(options)) {
    return readingMarkStore.save(articleId, paragraphIndex, sectionId, progressPercent)
  }

  const existing = await fetchCloudReadingMarkRow(articleId, options.userId)

  return saveCloudReadingMarkRecord(
    {
      articleId,
      paragraphIndex,
      completed: existing?.completed ?? false,
      sectionId,
      completedSections: existing?.completed_sections ?? [],
      progressPercent: progressPercent ?? existing?.progress_percent ?? null,
      updatedAt: new Date().toISOString(),
    },
    options.userId
  )
}

export async function clearReadingMark(articleId, options) {
  if (!useCloudSource(options)) {
    readingMarkStore.delete(articleId)
    return null
  }

  const existing = await fetchCloudReadingMarkRow(articleId, options.userId)

  await saveCloudReadingMarkRecord(
    {
      articleId,
      paragraphIndex: null,
      completed: false,
      completedSections: existing?.completed_sections ?? [],
      progressPercent: existing?.progress_percent ?? null,
      updatedAt: new Date().toISOString(),
    },
    options.userId
  )

  return null
}

export async function setReadingMarkCompleted(articleId, options) {
  if (!useCloudSource(options)) {
    return readingMarkStore.setCompleted(articleId)
  }

  const existing = await fetchCloudReadingMarkRow(articleId, options.userId)

  return saveCloudReadingMarkRecord(
    {
      articleId,
      paragraphIndex: existing?.paragraph_index ?? null,
      completed: true,
      progressPercent: 100,
      createdAt: existing?.created_at,
      updatedAt: new Date().toISOString(),
    },
    options.userId
  )
}

export async function loadLibrarySnapshot(options) {
  const [articles, bookmarks, readingMarks] = await Promise.all([
    listArticles(options),
    listAllBookmarks(options),
    listReadingMarks(options),
  ])

  return {
    articles,
    bookmarks,
    readingMarks,
  }
}

export async function exportLibraryData(options) {
  if (!useCloudSource(options)) {
    return exportData()
  }

  const snapshot = await loadLibrarySnapshot(options)

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    articles: snapshot.articles,
    bookmarks: snapshot.bookmarks,
    readingMarks: snapshot.readingMarks,
  }
}

export async function importLibraryData(data, options) {
  assertImportData(data)

  if (!useCloudSource(options)) {
    importData(data)
    return exportData()
  }

  for (const article of data.articles) {
    if (!article?.id || !article?.title || !article?.text) {
      continue
    }

    await saveArticle(article, options)
  }

  const articles = await listArticles(options)
  const articleIds = new Set(articles.map((article) => article.id))

  for (const bookmark of data.bookmarks) {
    if (!bookmark?.id || !bookmark?.articleId || !bookmark?.text || !bookmark?.type) {
      continue
    }

    if (!articleIds.has(bookmark.articleId)) {
      continue
    }

    await saveBookmark(bookmark, options)
  }

  for (const readingMark of Object.values(data.readingMarks ?? {})) {
    if (!readingMark?.articleId || !articleIds.has(readingMark.articleId)) {
      continue
    }

    await saveCloudReadingMarkRecord(
      {
        articleId: readingMark.articleId,
        paragraphIndex: readingMark.paragraphIndex ?? null,
        completed: Boolean(readingMark.completed),
        updatedAt: readingMark.updatedAt ?? new Date().toISOString(),
      },
      options.userId
    )
  }

  return exportLibraryData(options)
}
