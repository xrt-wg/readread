/**
 * 书架服务模块
 *
 * 职责：import_items 表的完整 CRUD + copyToReadingZone + 批量查询
 * 书架是纯云端功能——仅对已登录用户开放，不做 localStorage 同步。
 */

import { getSupabaseClient } from './supabase'
import { assembleSections, deriveParentIds, generateId, createDocument } from './extractors/index'
import { isLibraryAccessError, resolveLibraryErrorMessage } from './errorUtils'
import { saveArticle } from './library'

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const IMPORT_ITEM_COLUMNS = 'id, user_id, title, author, format, cover_url, lang, source_url, sections, total_word_count, section_count, kind, origin, share_status, share_source_id, created_at, updated_at, deleted_at'

// ─── 行映射 ────────────────────────────────────────────────────────────────────

/** 根据导入格式推断内容形态：epub → book，其余 → article */
function inferKind(format) {
  return format === 'epub' ? 'book' : 'article'
}

function mapImportItemRow(row) {
  return {
    id:              row.id,
    userId:          row.user_id,
    title:           row.title,
    author:          row.author,
    format:          row.format,
    kind:            row.kind || 'article',
    coverUrl:        row.cover_url,
    lang:            row.lang,
    sourceUrl:       row.source_url,
    sections:        row.sections,
    totalWordCount:  row.total_word_count,
    sectionCount:    row.section_count,
    origin:          row.origin,
    shareStatus:     row.share_status,
    shareSourceId:   row.share_source_id,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
    deletedAt:       row.deleted_at,
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * 从 ExtractionResult 装配完整的 ImportItem 对象并持久化。
 *
 * @param {import('../types/extractor').ExtractionResult} result
 * @param {Object} options
 * @param {string} options.userId
 * @param {'imported'|'shared'|'featured'|'featured_legacy'} [options.origin] — 默认 'imported'
 * @param {string} [options.shareSourceId] — origin='shared'/'featured'/'featured_legacy' 时使用
 * @returns {Promise<Object>} ImportItem
 */
export async function createImportItem(result, { userId, origin = 'imported', shareSourceId = null }) {
  const sections = assembleSections(result.sections)
  deriveParentIds(sections)

  const importItem = {
    id:              generateId('imp_'),
    user_id:         userId,
    title:           result.meta.title,
    author:          result.meta.author ?? null,
    format:          result.meta.format,
    cover_url:       result.meta.coverUrl ?? null,
    lang:            result.meta.lang ?? 'auto',
    source_url:      result.meta.sourceUrl ?? null,
    sections,
    total_word_count: sections.reduce((sum, s) => sum + s.body.wordCount, 0),
    section_count:    sections.length,
    kind:             inferKind(result.meta.format),
    origin,
    share_status:    'private',
    share_source_id: shareSourceId,
    created_at:      new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('import_items')
    .insert(importItem)
    .select(IMPORT_ITEM_COLUMNS)
    .single()

  if (error) {
    throw error
  }

  return mapImportItemRow(data)
}

/**
 * 获取用户的所有素材（排除已软删除）。
 */
export async function fetchImportItems(userId) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('import_items')
    .select(IMPORT_ITEM_COLUMNS)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return data.map(mapImportItemRow)
}

/**
 * 获取单个素材。
 */
export async function fetchImportItemById(id) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('import_items')
    .select(IMPORT_ITEM_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data ? mapImportItemRow(data) : null
}

/**
 * 批量获取素材标题（避免 N+1 查询）。
 * @param {string[]} ids
 * @returns {Promise<Map<string, string>>} id → title
 */
export async function fetchImportItemTitlesByIds(ids) {
  if (!ids || ids.length === 0) {
    return new Map()
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('import_items')
    .select('id, title')
    .in('id', ids)
    .is('deleted_at', null)

  if (error) {
    throw error
  }

  const map = new Map()
  for (const row of data) {
    map.set(row.id, row.title)
  }
  return map
}

/**
 * 部分更新素材字段。
 */
export async function updateImportItem(id, patch) {
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
    .from('import_items')
    .update(dbPatch)
    .eq('id', id)
    .is('deleted_at', null)
    .select(IMPORT_ITEM_COLUMNS)
    .single()

  if (error) {
    throw error
  }

  return mapImportItemRow(data)
}

/**
 * 计数某素材已移入的未删除文章数。
 */
export async function countImportReferences(importItemId) {
  const client = getSupabaseClient()
  const { count, error } = await client
    .from('articles')
    .select('id', { count: 'exact', head: true })
    .eq('source_import_id', importItemId)
    .is('deleted_at', null)

  if (error) {
    throw error
  }

  return count ?? 0
}

/**
 * 删除素材（RPC 原子操作：SET NULL articles.source_import_id + 软删除 import_items）。
 */
export async function deleteImportItem(importItemId) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .rpc('delete_import_item', { p_import_item_id: importItemId })

  if (error) {
    throw error
  }

  return data  // affected_articles 计数
}

// ─── 移入操作 ──────────────────────────────────────────────────────────────────

/**
 * 将素材深拷贝移入阅读区，生成独立的 Document 副本。
 *
 * @param {Object} importItem — mapImportItemRow 返回的对象
 * @returns {Promise<Object>} Document（mapArticleRow 返回的形状）
 */
export async function copyToReadingZone(importItem, { canUseCloudLibrary }) {
  // 1. 深拷贝 sections——这是"独立副本"的保证
  const sections = structuredClone(importItem.sections)

  // 2. 构造 ExtractionResult-like 对象（复用 createDocument 工厂）
  const extractionResult = {
    meta: {
      title:     importItem.title,
      author:    importItem.author,
      format:    importItem.format,
      coverUrl:  importItem.coverUrl,
      lang:      importItem.lang,
      sourceUrl: importItem.sourceUrl ?? undefined,
    },
    sections: sections.map((s) => ({
      heading:  s.heading,
      depth:    s.depth,
      order:    s.order,
      body: {
        text:     s.body.text,
        markdown: s.body.markdown,
      },
    })),
  }

  // 3. 工厂函数生成 Document（分配新 id、新 wordCount、deriveParentIds）
  const document = createDocument(extractionResult)

  // 4. 设置溯源字段
  document.source_import_id = importItem.id
  document.imported_at = new Date().toISOString()
  document.sourceType = importItem.format
  document.kind = importItem.kind

  // 5. 写入 articles 表
  return saveArticle(document, { canUseCloudLibrary, userId: importItem.userId })
}
