/**
 * 阅读内容统一服务模块
 *
 * 职责：readings 表的完整 CRUD + 状态流转 + 书签/阅读进度
 * 书架区 = WHERE reading_status != 'reading'
 * 阅读区 = WHERE reading_status = 'reading'
 *
 * 合并自 library.js（原 articles CRUD）和 importItems.js（原 import_items CRUD）
 */

import { articleStore, bookmarkStore, exportData, importData, readingMarkStore } from '../store/storage'
import { getSupabaseClient } from './supabase'
import { getSession } from './supabase/auth'
import { isLibraryAccessError, resolveLibraryErrorMessage } from './errorUtils'
import { isDue, shuffleArray } from '../utils/reviewUtils'
import { assembleSections, deriveParentIds, generateId } from './extractors/index'

// ─── 常量 ──────────────────────────────────────────────────────────────────────

/** readings 表列表列（不含 sections，避免 MB 级无效传输） */
const READING_LIST_COLUMNS = 'id, user_id, title, author, format, cover_url, lang, source_url, total_word_count, section_count, kind, reading_status, reading_started_at, reading_finished_at, origin, share_status, share_source_id, created_at, updated_at, deleted_at'

/** readings 表详情列（含 sections 正文，仅供 getReading 等详情接口使用） */
const READING_DETAIL_COLUMNS = READING_LIST_COLUMNS + ', sections'

/** @deprecated 使用 READING_LIST_COLUMNS 或 READING_DETAIL_COLUMNS */
const READING_COLUMNS = READING_DETAIL_COLUMNS

/** bookmarks 表所有列 */
const BOOKMARK_COLUMNS = 'id, user_id, reading_id, type, text, translation, translation_provider, context_sentence, context_translation, translation_status, paragraph_index, char_offset, review_count, next_review_at, familiarity, section_id, section_heading, created_at, updated_at, deleted_at, readings!inner(title)'

/** reading_marks 表所有列 */
const READING_MARK_COLUMNS = 'user_id, reading_id, paragraph_index, completed, section_id, completed_sections, progress_percent, created_at, updated_at'

/** 阅读区最大书籍数（可配置） */
const MAX_ACTIVE_READINGS = 5

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function useCloudSource({ canUseCloudLibrary, userId }) {
  return Boolean(canUseCloudLibrary && userId)
}

/** 根据导入格式推断内容形态：epub → book，其余 → article */
function inferKind(format) {
  return format === 'epub' ? 'book' : 'article'
}

// ─── 行映射 ────────────────────────────────────────────────────────────────────

function mapReadingRow(row) {
  return {
    // 基础字段
    userId: row.user_id ?? null,
    id: row.id,
    title: row.title,
    author: row.author ?? null,
    format: row.format || 'paste',
    coverUrl: row.cover_url ?? null,
    lang: row.lang || 'auto',
    sourceUrl: row.source_url ?? null,
    sections: row.sections ?? [],
    totalWordCount: row.total_word_count ?? 0,
    sectionCount: row.section_count ?? 1,
    kind: row.kind || 'article',
    // 状态字段
    readingStatus: row.reading_status || 'unread',
    readingStartedAt: row.reading_started_at ?? null,
    readingFinishedAt: row.reading_finished_at ?? null,
    // 来源字段
    origin: row.origin || 'imported',
    shareStatus: row.share_status || 'private',
    shareSourceId: row.share_source_id ?? null,
    // 时间戳
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
    // === 兼容旧字段（保持现有调用方兼容） ===
    get text() {
      // 从 sections 派生全文（兼容旧代码中的 article.text 访问）
      if (!this._computedText && this.sections?.length) {
        this._computedText = this.sections.map(s => s.body?.text || '').join('\n\n')
      }
      return this._computedText || ''
    },
    get markdown() {
      if (!this._computedMarkdown && this.sections?.length) {
        this._computedMarkdown = this.sections
          .map(s => s.body?.markdown || s.body?.text || '')
          .join('\n\n')
      }
      return this._computedMarkdown || null
    },
    get wordCount() { return this.totalWordCount },
    get sourceType() { return this.format },
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
    articleId: row.reading_id,
    paragraphIndex: row.paragraph_index,
    charOffset: row.char_offset,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewCount: row.review_count,
    nextReviewAt: row.next_review_at,
    familiarity: row.familiarity,
    sectionId: row.section_id,
    sectionHeading: row.section_heading,
    // join (FK 指向 readings 表)
    articleTitle: row.readings?.title ?? null,
  }
}

function mapReadingMarkRow(row) {
  if (!row) return null

  if (row.paragraph_index === null && row.completed === false) {
    return null
  }

  return {
    articleId: row.reading_id,
    paragraphIndex: row.paragraph_index,
    completed: row.completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

// ─── 数据库辅助 ────────────────────────────────────────────────────────────────

async function fetchCloudReadingMarkRow(readingId, userId) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('reading_marks')
    .select(READING_MARK_COLUMNS)
    .eq('user_id', userId)
    .eq('reading_id', readingId)
    .maybeSingle()

  if (error) throw error
  return data
}

async function saveCloudReadingMarkRecord(record, userId) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('reading_marks')
    .upsert(
      {
        user_id: userId,
        reading_id: record.articleId,
        paragraph_index: record.paragraphIndex ?? null,
        completed: Boolean(record.completed),
        section_id: record.sectionId ?? null,
        completed_sections: record.completedSections ?? [],
        progress_percent: record.progressPercent ?? null,
        created_at: record.createdAt ?? new Date().toISOString(),
        updated_at: record.updatedAt ?? new Date().toISOString(),
      },
      {
        onConflict: 'user_id,reading_id',
        ignoreDuplicates: false,
      }
    )
    .select(READING_MARK_COLUMNS)
    .single()

  if (error) throw error
  return mapReadingMarkRow(data)
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

// ─── 书架区查询 ────────────────────────────────────────────────────────────────

/**
 * 获取书架上的所有阅读内容（非 reading 状态）。
 */
export async function listShelfReadings(options) {
  if (!useCloudSource(options)) {
    return articleStore.getAll().filter(a => (a.readingStatus || 'unread') !== 'reading')
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('readings')
    .select(READING_LIST_COLUMNS)
    .eq('user_id', options.userId)
    .neq('reading_status', 'reading')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data.map(mapReadingRow)
}

// ─── 阅读区查询 ────────────────────────────────────────────────────────────────

/**
 * 获取阅读区中的所有活跃阅读内容（reading 状态）。
 */
export async function listReadingZone(options) {
  if (!useCloudSource(options)) {
    return articleStore.getAll().filter(a => a.readingStatus === 'reading')
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('readings')
    .select(READING_LIST_COLUMNS)
    .eq('user_id', options.userId)
    .eq('reading_status', 'reading')
    .is('deleted_at', null)
    .order('reading_started_at', { ascending: false })

  if (error) throw error
  return data.map(mapReadingRow)
}

// ─── 兼容旧 API ────────────────────────────────────────────────────────────────

/** @deprecated 使用 listShelfReadings + listReadingZone 替代 */
export async function listArticles(options) {
  if (!useCloudSource(options)) {
    return articleStore.getAll()
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('readings')
    .select(READING_LIST_COLUMNS)
    .eq('user_id', options.userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data.map(mapReadingRow)
}

// ─── 创建与更新 ────────────────────────────────────────────────────────────────

/**
 * 从 ExtractionResult 创建新的阅读内容。
 * 合并了原 createImportItem（书架创建）和 saveArticle 中的新建逻辑。
 *
 * @param {import('../types/extractor').ExtractionResult} result
 * @param {Object} options
 * @param {string} options.userId
 * @param {'imported'|'shared'|'featured'|'featured_legacy'|'manual'} [options.origin]
 * @param {string} [options.shareSourceId]
 * @param {boolean} [options.startReading] - 是否创建后直接开始阅读
 */
export async function createReading(result, { userId, origin = 'imported', shareSourceId = null, startReading = false, canUseCloudLibrary } = {}) {
  const sections = assembleSections(result.sections)
  deriveParentIds(sections)

  const now = new Date().toISOString()
  const reading = {
    id: generateId('rd_'),
    user_id: userId,
    title: result.meta.title,
    author: result.meta.author ?? null,
    format: result.meta.format,
    cover_url: result.meta.coverUrl ?? null,
    lang: result.meta.lang ?? 'auto',
    source_url: result.meta.sourceUrl ?? null,
    sections,
    total_word_count: sections.reduce((sum, s) => sum + s.body.wordCount, 0),
    section_count: sections.length,
    kind: inferKind(result.meta.format),
    reading_status: startReading ? 'reading' : 'unread',
    reading_started_at: startReading ? now : null,
    reading_finished_at: null,
    origin,
    share_status: 'private',
    share_source_id: shareSourceId,
    created_at: now,
    updated_at: now,
  }

  if (!useCloudSource({ canUseCloudLibrary, userId })) {
    // localStorage 路径：使用旧 articleStore（兼容过渡期）
    const legacyArticle = {
      id: reading.id,
      title: reading.title,
      text: sections.map(s => s.body.text).join('\n\n'),
      markdown: sections.map(s => s.body.markdown || s.body.text).join('\n\n'),
      wordCount: reading.total_word_count,
      sourceType: reading.format,
      sourceUrl: reading.source_url,
      author: reading.author,
      format: reading.format,
      coverUrl: reading.cover_url,
      lang: reading.lang,
      sections: reading.sections,
      sectionCount: reading.section_count,
      kind: reading.kind,
      readingStatus: reading.reading_status,
      createdAt: reading.created_at,
      updatedAt: reading.updated_at,
    }
    return articleStore.save(legacyArticle)
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('readings')
    .insert(reading)
    .select(READING_COLUMNS)
    .single()

  if (error) throw error
  return mapReadingRow(data)
}

/**
 * 保存/更新阅读内容（兼容旧 saveArticle API）。
 * 遵循 D7 编辑策略：reading 状态禁止编辑。
 */
export async function saveReading(reading, options) {
  if (!useCloudSource(options)) {
    return articleStore.save(reading)
  }

  // D7 策略：reading 状态禁止编辑
  if (reading.readingStatus === 'reading' || reading.reading_status === 'reading') {
    throw new Error('正在阅读中的内容不可编辑，请先放回书架')
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('readings')
    .upsert(
      {
        id: reading.id,
        user_id: options.userId,
        title: reading.title,
        author: reading.author ?? null,
        format: reading.format ?? 'paste',
        cover_url: reading.coverUrl ?? null,
        lang: reading.lang ?? 'auto',
        source_url: reading.sourceUrl ?? null,
        sections: reading.sections ?? [],
        total_word_count: reading.totalWordCount ?? reading.wordCount ?? 0,
        section_count: reading.sectionCount ?? 1,
        kind: reading.kind ?? 'article',
        reading_status: reading.readingStatus ?? reading.reading_status ?? 'unread',
        reading_started_at: reading.readingStartedAt ?? null,
        reading_finished_at: reading.readingFinishedAt ?? null,
        origin: reading.origin ?? 'imported',
        share_status: reading.shareStatus ?? 'private',
        share_source_id: reading.shareSourceId ?? null,
        deleted_at: null,
      },
      {
        onConflict: 'id',
        ignoreDuplicates: false,
      }
    )
    .select(READING_COLUMNS)
    .single()

  if (error) throw error
  return mapReadingRow(data)
}

/** @deprecated 使用 saveReading 替代 */
export async function saveArticle(article, options) {
  return saveReading(article, options)
}

/**
 * 部分更新阅读内容字段（兼容旧 updateImportItem API）。
 * 遵循 D7 编辑策略。
 */
export async function updateReading(id, patch, options = {}) {
  const canUseCloud = options.canUseCloudLibrary !== undefined ? options.canUseCloudLibrary : !!(options.userId)
  if (!canUseCloud) {
    // localStorage：直接修改 store
    const articles = articleStore.getAll()
    const idx = articles.findIndex(a => a.id === id)
    if (idx === -1) return null
    const updated = { ...articles[idx] }
    if (patch.title !== undefined) updated.title = patch.title
    if (patch.author !== undefined) updated.author = patch.author
    if (patch.cover_url !== undefined) updated.coverUrl = patch.cover_url
    if (patch.lang !== undefined) updated.lang = patch.lang
    if (patch.sections !== undefined) {
      updated.sections = patch.sections
      updated.totalWordCount = patch.sections.reduce((sum, s) => sum + (s.body?.wordCount ?? 0), 0)
      updated.sectionCount = patch.sections.length
    }
    if (patch.kind !== undefined) updated.kind = patch.kind
    if (patch.share_status !== undefined) updated.shareStatus = patch.share_status
    updated.updatedAt = new Date().toISOString()
    return articleStore.save(updated)
  }

  // D7 策略：检查是否处于 reading 状态
  const current = await getReading(id, options)
  if (current && current.readingStatus === 'reading') {
    throw new Error('正在阅读中的内容不可编辑，请先放回书架')
  }

  const dbPatch = {}
  if (patch.title !== undefined) dbPatch.title = patch.title
  if (patch.author !== undefined) dbPatch.author = patch.author
  if (patch.cover_url !== undefined) dbPatch.cover_url = patch.cover_url
  if (patch.lang !== undefined) dbPatch.lang = patch.lang
  if (patch.sections !== undefined) {
    dbPatch.sections = patch.sections
    dbPatch.total_word_count = patch.sections.reduce((sum, s) => sum + (s.body?.wordCount ?? 0), 0)
    dbPatch.section_count = patch.sections.length
  }
  if (patch.kind !== undefined) dbPatch.kind = patch.kind
  if (patch.share_status !== undefined) dbPatch.share_status = patch.share_status

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('readings')
    .update(dbPatch)
    .eq('id', id)
    .is('deleted_at', null)
    .select(READING_COLUMNS)
    .single()

  if (error) throw error
  return mapReadingRow(data)
}

// ─── 单条查询 ──────────────────────────────────────────────────────────────────

/**
 * 获取单个阅读内容。
 */
export async function getReading(id, options = {}) {
  const canUseCloud = options.canUseCloudLibrary !== undefined ? options.canUseCloudLibrary : !!(options.userId)
  if (!canUseCloud) {
    return articleStore.getById(id) || null
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('readings')
    .select(READING_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  return data ? mapReadingRow(data) : null
}

// ─── 状态流转 ──────────────────────────────────────────────────────────────────

/**
 * 取书：将阅读内容移入阅读区。
 * Cloud 路径通过 RPC start_reading 原子检查上限。
 */
export async function startReading(readingId, options) {
  if (!useCloudSource(options)) {
    const articles = articleStore.getAll()
    const active = articles.filter(a => a.readingStatus === 'reading')
    if (active.length >= MAX_ACTIVE_READINGS) {
      throw new Error(`阅读区已满（上限 ${MAX_ACTIVE_READINGS} 本），请先放回一本书`)
    }
    const article = articles.find(a => a.id === readingId)
    if (!article) throw new Error('阅读内容不存在')
    article.readingStatus = 'reading'
    article.readingStartedAt = article.readingStartedAt || new Date().toISOString()
    article.updatedAt = new Date().toISOString()
    return articleStore.save(article)
  }

  // 使用 RPC 原子操作（SELECT ... FOR UPDATE 防竞态）
  const client = getSupabaseClient()
  const { error } = await client
    .rpc('start_reading', {
      p_reading_id: readingId,
      p_user_id: options.userId,
      p_max_limit: MAX_ACTIVE_READINGS,
    })

  if (error) throw error

  // 返回更新后的 reading
  return getReading(readingId, options)
}

/**
 * 还书：将阅读内容放回书架。
 * @param {boolean} [completed=false] - 是否已读完
 */
export async function returnToShelf(readingId, { completed = false, ...options } = {}) {
  const newStatus = completed ? 'completed' : 'in_progress'

  if (!useCloudSource(options)) {
    const article = articleStore.getById(readingId)
    if (!article) throw new Error('阅读内容不存在')
    article.readingStatus = newStatus
    if (completed) {
      article.readingFinishedAt = new Date().toISOString()
    }
    article.updatedAt = new Date().toISOString()
    return articleStore.save(article)
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('readings')
    .update({
      reading_status: newStatus,
      reading_finished_at: completed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', readingId)
    .eq('user_id', options.userId)
    .eq('reading_status', 'reading')
    .is('deleted_at', null)
    .select(READING_COLUMNS)
    .single()

  if (error) throw error
  return mapReadingRow(data)
}

/**
 * 重新阅读：清除所有阅读数据，状态回到 unread。
 */
export async function resetReading(readingId, options) {
  if (!useCloudSource(options)) {
    bookmarkStore.deleteByArticle(readingId)
    readingMarkStore.delete(readingId)
    const article = articleStore.getById(readingId)
    if (article) {
      article.readingStatus = 'unread'
      article.readingStartedAt = null
      article.readingFinishedAt = null
      article.updatedAt = new Date().toISOString()
      articleStore.save(article)
    }
    return
  }

  const client = getSupabaseClient()
  const now = new Date().toISOString()

  // 1. 软删除所有 bookmarks
  await client
    .rpc('soft_delete_bookmarks_for_reading', { p_reading_id: readingId })

  // 2. 清除 reading_mark
  await client
    .from('reading_marks')
    .delete()
    .eq('user_id', options.userId)
    .eq('reading_id', readingId)

  // 3. 重置 reading_status
  await client
    .from('readings')
    .update({
      reading_status: 'unread',
      reading_started_at: null,
      reading_finished_at: null,
      updated_at: now,
    })
    .eq('id', readingId)
    .eq('user_id', options.userId)
}

// ─── 删除 ──────────────────────────────────────────────────────────────────────

async function executeCloudDelete(readingId, userId) {
  const client = getSupabaseClient()
  const now = new Date().toISOString()

  const [{ error: readingError }, { error: bookmarkError }, { error: readingMarkError }] = await Promise.all([
    client
      .rpc('soft_delete_reading', { p_reading_id: readingId }),
    client
      .rpc('soft_delete_bookmarks_for_reading', { p_reading_id: readingId }),
    client
      .from('reading_marks')
      .upsert(
        {
          user_id: userId,
          reading_id: readingId,
          paragraph_index: null,
          completed: false,
          updated_at: now,
        },
        {
          onConflict: 'user_id,reading_id',
          ignoreDuplicates: false,
        }
      ),
  ])

  return { readingError, bookmarkError, readingMarkError }
}

function throwIfError({ readingError, bookmarkError, readingMarkError }) {
  if (readingError) throw readingError
  if (bookmarkError) throw bookmarkError
  if (readingMarkError) throw readingMarkError
}

/**
 * 删除阅读内容及关联数据（书签 + 阅读标记）。
 */
export async function deleteReading(readingId, options) {
  if (!useCloudSource(options)) {
    articleStore.delete(readingId)
    return
  }

  const userId = options.userId

  const result = await executeCloudDelete(readingId, userId)

  if (isLibraryAccessError(result.readingError) || isLibraryAccessError(result.bookmarkError) || isLibraryAccessError(result.readingMarkError)) {
    try {
      await getSession()
    } catch (_) {
      throwIfError(result)
      return
    }

    const retryResult = await executeCloudDelete(readingId, userId)
    throwIfError(retryResult)
    return
  }

  throwIfError(result)
}

/** @deprecated 使用 deleteReading 替代 */
export async function deleteArticle(articleId, options) {
  return deleteReading(articleId, options)
}

// ─── 书签操作（与 library.js 一致，仅表引用路径不变） ─────────────────────────

export async function listBookmarksByArticle(readingId, options) {
  if (!useCloudSource(options)) {
    return bookmarkStore.getByArticle(readingId)
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('bookmarks')
    .select(BOOKMARK_COLUMNS)
    .eq('user_id', options.userId)
    .eq('reading_id', readingId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) throw error
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

  if (error) throw error
  return data.map(mapBookmarkRow)
}

export async function listDueBookmarks(options, excludeIds = new Set()) {
  const all = await listAllBookmarks(options)
  const now = Date.now()

  const newCards = []
  const dueCards = []
  const futureCards = []

  for (const bm of all) {
    if (excludeIds.has(bm.id)) continue
    if (!bm.reviewCount || bm.reviewCount === 0) {
      newCards.push(bm)
    } else if (isDue(bm, now)) {
      dueCards.push(bm)
    } else {
      futureCards.push(bm)
    }
  }

  dueCards.sort((a, b) => {
    if (!a.nextReviewAt) return -1
    if (!b.nextReviewAt) return 1
    return new Date(a.nextReviewAt).getTime() - new Date(b.nextReviewAt).getTime()
  })

  const pool = [...dueCards, ...newCards]
  const session = pool.slice(0, 10)

  if (session.length < 10 && futureCards.length > 0) {
    const fill = shuffleArray(futureCards).slice(0, 10 - session.length)
    session.push(...fill)
  }

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
        reading_id: bookmark.articleId,
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

  if (error) throw error
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

  if (error) throw error
}

// ─── 阅读进度操作 ──────────────────────────────────────────────────────────────

export async function getReadingMark(readingId, options) {
  if (!useCloudSource(options)) {
    return readingMarkStore.get(readingId)
  }

  const row = await fetchCloudReadingMarkRow(readingId, options.userId)
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

  if (error) throw error
  return mapReadingMarks(data)
}

export async function saveReadingMark(readingId, paragraphIndex, options, sectionId = null, progressPercent = null) {
  if (!useCloudSource(options)) {
    return readingMarkStore.save(readingId, paragraphIndex, sectionId, progressPercent)
  }

  const existing = await fetchCloudReadingMarkRow(readingId, options.userId)

  return saveCloudReadingMarkRecord(
    {
      articleId: readingId,
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

export async function clearReadingMark(readingId, options) {
  if (!useCloudSource(options)) {
    readingMarkStore.delete(readingId)
    return null
  }

  const existing = await fetchCloudReadingMarkRow(readingId, options.userId)

  await saveCloudReadingMarkRecord(
    {
      articleId: readingId,
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

export async function setReadingMarkCompleted(readingId, options) {
  if (!useCloudSource(options)) {
    return readingMarkStore.setCompleted(readingId)
  }

  const existing = await fetchCloudReadingMarkRow(readingId, options.userId)

  return saveCloudReadingMarkRecord(
    {
      articleId: readingId,
      paragraphIndex: existing?.paragraph_index ?? null,
      completed: true,
      progressPercent: 100,
      createdAt: existing?.created_at,
      updatedAt: new Date().toISOString(),
    },
    options.userId
  )
}

// ─── 快照与导入导出 ────────────────────────────────────────────────────────────

export async function loadLibrarySnapshot(options) {
  const [readings, bookmarks, readingMarks] = await Promise.all([
    listShelfReadings(options),
    listAllBookmarks(options),
    listReadingMarks(options),
  ])

  // 兼容：合并书架 + 阅读区
  const activeReadings = useCloudSource(options)
    ? await listReadingZone(options)
    : []

  return {
    articles: [...readings, ...activeReadings],    // 兼容旧 API
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
    if (!article?.id || !article?.title || (!article?.text && !article?.sections?.length)) {
      continue
    }
    await saveReading(article, options)
  }

  const articles = await listArticles(options)
  const articleIds = new Set(articles.map((a) => a.id))

  for (const bookmark of data.bookmarks) {
    if (!bookmark?.id || !bookmark?.readingId || !bookmark?.text || !bookmark?.type) {
      continue
    }
    if (!articleIds.has(bookmark.articleId)) {
      continue
    }
    await saveBookmark(bookmark, options)
  }

  for (const readingMark of Object.values(data.readingMarks ?? {})) {
    if (!readingMark?.readingId || !articleIds.has(readingMark.articleId)) {
      continue
    }
    await saveCloudReadingMarkRecord(
      {
        readingId: readingMark.articleId,
        paragraphIndex: readingMark.paragraphIndex ?? null,
        completed: Boolean(readingMark.completed),
        updatedAt: readingMark.updatedAt ?? new Date().toISOString(),
      },
      options.userId
    )
  }

  return exportLibraryData(options)
}

// ─── 书架辅助（兼容旧 importItems API） ────────────────────────────────────────

/** @deprecated 使用 createReading 替代 */
export async function createImportItem(result, { userId, origin = 'imported', shareSourceId = null }) {
  return createReading(result, { userId, origin, shareSourceId, canUseCloudLibrary: true })
}

/** @deprecated 使用 listShelfReadings 替代 */
export async function fetchImportItems(userId) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('readings')
    .select(READING_LIST_COLUMNS)
    .eq('user_id', userId)
    .neq('reading_status', 'reading')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data.map(mapReadingRow)
}

/** @deprecated 使用 getReading 替代 */
export async function fetchImportItemById(id) {
  return getReading(id, { userId: undefined })
}
