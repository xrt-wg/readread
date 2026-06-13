import { articleStore, bookmarkStore, exportData, importData, readingMarkStore } from '../store/storage'
import { getSupabaseClient } from './supabase'
import { getSession } from './supabase/auth'

const ARTICLE_COLUMNS = 'id, user_id, title, text, markdown, word_count, source_type, source_url, author, format, cover_url, lang, sections, section_count, created_at, updated_at, deleted_at'
const BOOKMARK_COLUMNS = 'id, user_id, article_id, type, text, translation, context_sentence, context_translation, translation_status, paragraph_index, char_offset, review_count, next_review_at, familiarity, section_id, section_heading, created_at, updated_at, deleted_at'
const READING_MARK_COLUMNS = 'user_id, article_id, paragraph_index, completed, section_id, completed_sections, created_at, updated_at'

function useCloudSource({ canUseCloudLibrary, userId }) {
  return Boolean(canUseCloudLibrary && userId)
}

export function isLibraryAccessError(error) {
  const message = String(error?.message || '').toLowerCase()
  const code = String(error?.code || '').toLowerCase()
  const status = error?.status

  return status === 401
    || status === 403
    || code === '401'
    || code === '403'
    || code === '42501'
    || message.includes('jwt')
    || message.includes('session')
    || message.includes('unauthorized')
    || message.includes('forbidden')
    || message.includes('permission denied')
    || message.includes('row-level security')
}

export function resolveLibraryErrorMessage(error, fallback) {
  if (isLibraryAccessError(error)) {
    return '当前云端会话已失效或访问权限已变化，系统正在刷新身份状态。'
  }

  return error?.message || fallback
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
  }
}

function mapBookmarkRow(row) {
  return {
    id: row.id,
    type: row.type,
    text: row.text,
    translation: row.translation,
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
      .from('articles')
      .update({ deleted_at: now })
      .eq('user_id', userId)
      .eq('id', articleId)
      .is('deleted_at', null),
    client
      .from('bookmarks')
      .update({ deleted_at: now })
      .eq('user_id', userId)
      .eq('article_id', articleId)
      .is('deleted_at', null),
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

  return data.map(mapBookmarkRow)
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

export async function saveReadingMark(articleId, paragraphIndex, options, sectionId = null) {
  if (!useCloudSource(options)) {
    const mark = readingMarkStore.save(articleId, paragraphIndex)
    if (sectionId) mark.sectionId = sectionId
    return mark
  }

  return saveCloudReadingMarkRecord(
    {
      articleId,
      paragraphIndex,
      completed: false,
      sectionId,
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

  await saveCloudReadingMarkRecord(
    {
      articleId,
      paragraphIndex: null,
      completed: false,
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
