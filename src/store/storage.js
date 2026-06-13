/**
 * StorageAdapter — 统一数据读写接口
 * 当前实现：localStorage
 * 将来替换为 API 调用时，只需修改此文件，组件层无需改动
 */

import { migrateArticleToDocument } from '../types/document'

const KEYS = {
  ARTICLES: 'rr_articles',
  BOOKMARKS: 'rr_bookmarks',
  READING_MARKS: 'rr_reading_marks',
  LOCAL_MIGRATION_META: 'rr_local_migration_meta',
}

// ─── 工具 ────────────────────────────────────────────────────────────────────

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function createDefaultLocalMigrationMeta() {
  return {
    claimedByUserId: null,
    claimedAt: null,
    completedByUserId: null,
    completedAt: null,
    updatedAt: null,
  }
}

function normalizeLocalMigrationMeta(meta) {
  return {
    ...createDefaultLocalMigrationMeta(),
    ...(meta && typeof meta === 'object' ? meta : {}),
  }
}

export function getLocalMigrationMeta() {
  return normalizeLocalMigrationMeta(readJSON(KEYS.LOCAL_MIGRATION_META, createDefaultLocalMigrationMeta()))
}

function writeLocalMigrationMeta(meta) {
  writeJSON(KEYS.LOCAL_MIGRATION_META, normalizeLocalMigrationMeta(meta))
}

export function touchLocalMigrationData() {
  const now = new Date().toISOString()
  const nextMeta = {
    ...createDefaultLocalMigrationMeta(),
    updatedAt: now,
  }

  writeLocalMigrationMeta(nextMeta)

  return nextMeta
}

export function claimLocalMigrationData(userId) {
  const meta = getLocalMigrationMeta()

  if (!userId) {
    return meta
  }

  if (meta.claimedByUserId && meta.claimedByUserId !== userId) {
    return meta
  }

  const nextMeta = {
    ...meta,
    claimedByUserId: userId,
    claimedAt: meta.claimedAt ?? new Date().toISOString(),
  }

  writeLocalMigrationMeta(nextMeta)

  return nextMeta
}

export function clearLocalLibraryData() {
  localStorage.removeItem(KEYS.ARTICLES)
  localStorage.removeItem(KEYS.BOOKMARKS)
  localStorage.removeItem(KEYS.READING_MARKS)
}

export function markLocalMigrationCompleted(userId) {
  const now = new Date().toISOString()
  const meta = getLocalMigrationMeta()
  const nextMeta = {
    ...meta,
    claimedByUserId: userId,
    claimedAt: meta.claimedAt ?? now,
    completedByUserId: userId,
    completedAt: now,
    updatedAt: meta.updatedAt ?? now,
  }

  writeLocalMigrationMeta(nextMeta)
  clearLocalLibraryData()

  return nextMeta
}

// ─── Articles ────────────────────────────────────────────────────────────────

export const articleStore = {
  getAll() {
    return readJSON(KEYS.ARTICLES, [])
  },

  getById(id) {
    return this.getAll().find((a) => a.id === id) ?? null
  },

  save(article) {
    const articles = this.getAll()
    const idx = articles.findIndex((a) => a.id === article.id)
    if (idx >= 0) {
      articles[idx] = article
    } else {
      articles.unshift(article)
    }
    writeJSON(KEYS.ARTICLES, articles)
    touchLocalMigrationData()
    return article
  },

  delete(id) {
    const articles = this.getAll().filter((a) => a.id !== id)
    writeJSON(KEYS.ARTICLES, articles)
    touchLocalMigrationData()
    // 同步删除该文章的收藏
    bookmarkStore.deleteByArticle(id)
    readingMarkStore.delete(id)
  },
}

// ─── Bookmarks ───────────────────────────────────────────────────────────────

export const bookmarkStore = {
  getAll() {
    return readJSON(KEYS.BOOKMARKS, [])
  },

  getByArticle(articleId) {
    return this.getAll().filter((b) => b.articleId === articleId)
  },

  save(bookmark) {
    const bookmarks = this.getAll()
    const idx = bookmarks.findIndex((b) => b.id === bookmark.id)
    if (idx >= 0) {
      bookmarks[idx] = bookmark
    } else {
      bookmarks.push(bookmark)
    }
    writeJSON(KEYS.BOOKMARKS, bookmarks)
    touchLocalMigrationData()
    return bookmark
  },

  delete(id) {
    const bookmarks = this.getAll().filter((b) => b.id !== id)
    writeJSON(KEYS.BOOKMARKS, bookmarks)
    touchLocalMigrationData()
  },

  deleteByArticle(articleId) {
    const bookmarks = this.getAll().filter((b) => b.articleId !== articleId)
    writeJSON(KEYS.BOOKMARKS, bookmarks)
    touchLocalMigrationData()
  },
}

// ─── Reading Marks ───────────────────────────────────────────────────────────

export const readingMarkStore = {
  getAll() {
    return readJSON(KEYS.READING_MARKS, {})
  },

  get(articleId) {
    return this.getAll()[articleId] ?? null
  },

  save(articleId, paragraphIndex) {
    const marks = this.getAll()
    const existing = marks[articleId]
    marks[articleId] = {
      articleId,
      paragraphIndex,
      completed: existing?.completed ?? false,
      sectionId: existing?.sectionId ?? null,
      completedSections: existing?.completedSections ?? [],
      updatedAt: new Date().toISOString(),
    }
    writeJSON(KEYS.READING_MARKS, marks)
    touchLocalMigrationData()
    return marks[articleId]
  },

  setCompleted(articleId) {
    const marks = this.getAll()
    marks[articleId] = {
      articleId,
      paragraphIndex: marks[articleId]?.paragraphIndex ?? null,
      completed: true,
      sectionId: marks[articleId]?.sectionId ?? null,
      completedSections: marks[articleId]?.completedSections ?? [],
      updatedAt: new Date().toISOString(),
    }
    writeJSON(KEYS.READING_MARKS, marks)
    touchLocalMigrationData()
    return marks[articleId]
  },

  delete(articleId) {
    const marks = this.getAll()
    delete marks[articleId]
    writeJSON(KEYS.READING_MARKS, marks)
    touchLocalMigrationData()
  },
}

// ─── 数据导出 / 导入 ──────────────────────────────────────────────────────────

export function exportData() {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    articles: articleStore.getAll(),
    bookmarks: bookmarkStore.getAll(),
    readingMarks: readingMarkStore.getAll(),
  }
}

/**
 * 导入备份数据。兼容 v1（自动升级）和 v2。
 * 旧 version 1 数据中的 article 经 migrateArticleToDocument 升级后再写入。
 */
export function importData(data) {
  if (
    !data ||
    ![1, 2].includes(data.version) ||
    !Array.isArray(data.articles) ||
    !Array.isArray(data.bookmarks)
  ) {
    throw new Error('无效的备份文件格式')
  }

  let articles = data.articles

  // v1 → v2 自动升级：旧 Article 映射为新 Document
  if (data.version === 1) {
    articles = articles.map(migrateArticleToDocument)
  }

  writeJSON(KEYS.ARTICLES, articles)
  writeJSON(KEYS.BOOKMARKS, data.bookmarks)
  if (data.readingMarks && typeof data.readingMarks === 'object') {
    writeJSON(KEYS.READING_MARKS, data.readingMarks)
  }

  touchLocalMigrationData()
}

// ─── localStorage 数据回填 ─────────────────────────────────────────────────────

/**
 * 应用启动时调用。
 * 检测 localStorage 中的旧格式 articles，若缺少 sections 字段则自动升级。
 * 回填后保持原始 id 不变（不重命名 art_ → doc_）。
 */
export function migrateLocalStorageArticles() {
  const articles = articleStore.getAll()
  const needsMigration = articles.some(a => !a.sections)

  if (!needsMigration) return

  const migrated = articles.map(a =>
    a.sections ? a : migrateArticleToDocument(a)
  )
  writeJSON(KEYS.ARTICLES, migrated)
}

// ─── Document 工厂函数 ───────────────────────────────────────────────────────

/**
 * 创建新的 Document 对象。
 * 使用 "doc_" 前缀。单 section 文档（id: "s_main"）。
 *
 * @param {Object} params
 * @param {string} params.title
 * @param {string} params.text
 * @param {string|null} [params.markdown]
 * @param {string} [params.format] — 来源格式，默认 'paste'
 * @param {string|null} [params.sourceUrl] — 来源 URL
 * @returns {import('../types/document').Document}
 */
export function createDocument({ title, text, markdown = null, format = 'paste', sourceUrl = null }) {
  const wordCount = text.split(/\s+/).filter(Boolean).length
  return {
    id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    text,
    markdown,
    author: null,
    format,
    coverUrl: null,
    lang: 'auto',
    sourceUrl,
    sections: [
      {
        id: 's_main',
        heading: null,
        depth: 0,
        parentId: null,
        order: 0,
        body: {
          text,
          markdown,
          wordCount,
        },
      },
    ],
    totalWordCount: wordCount,
    sectionCount: 1,
    createdAt: new Date().toISOString(),
  }
}

// ─── Article 工厂函数（遗留兼容）──────────────────────────────────────────────

/**
 * @deprecated 使用 createDocument 替代。
 *             保留作为兼容别名，内部调用 createDocument。
 */
export function createArticle({ title, text, markdown = null }) {
  return createDocument({ title, text, markdown, format: 'paste' })
}

// ─── Bookmark 工厂函数 ────────────────────────────────────────────────────────

export function createBookmark({
  type,           // 'word' | 'phrase' | 'sentence' | 'paragraph'
  text,           // 选中的原文
  contextSentence,      // 所在完整句（word/phrase 有值）
  articleId,
  paragraphIndex, // 所在段落索引
  charOffset,     // 在段落中的起始字符偏移量
  sectionId = null,      // 所属 section.id（新增）
  sectionHeading = null, // section.heading 快照（新增）
}) {
  return {
    id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    text,
    translation: null,
    contextSentence: contextSentence ?? null,
    contextTranslation: null,
    translationStatus: 'pending',
    articleId,
    sectionId,
    sectionHeading,
    paragraphIndex,
    charOffset,
    createdAt: new Date().toISOString(),
    // 预留扩展字段（复习功能）
    reviewCount: 0,
    nextReviewAt: null,
    familiarity: 0, // 0-5
  }
}
