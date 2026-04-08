/**
 * StorageAdapter — 统一数据读写接口
 * 当前实现：localStorage
 * 将来替换为 API 调用时，只需修改此文件，组件层无需改动
 */

const KEYS = {
  ARTICLES: 'rr_articles',
  BOOKMARKS: 'rr_bookmarks',
  READING_MARKS: 'rr_reading_marks',
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
    return article
  },

  delete(id) {
    const articles = this.getAll().filter((a) => a.id !== id)
    writeJSON(KEYS.ARTICLES, articles)
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
    return bookmark
  },

  delete(id) {
    const bookmarks = this.getAll().filter((b) => b.id !== id)
    writeJSON(KEYS.BOOKMARKS, bookmarks)
  },

  deleteByArticle(articleId) {
    const bookmarks = this.getAll().filter((b) => b.articleId !== articleId)
    writeJSON(KEYS.BOOKMARKS, bookmarks)
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
      updatedAt: new Date().toISOString(),
    }
    writeJSON(KEYS.READING_MARKS, marks)
    return marks[articleId]
  },

  setCompleted(articleId) {
    const marks = this.getAll()
    marks[articleId] = {
      articleId,
      paragraphIndex: marks[articleId]?.paragraphIndex ?? null,
      completed: true,
      updatedAt: new Date().toISOString(),
    }
    writeJSON(KEYS.READING_MARKS, marks)
    return marks[articleId]
  },

  delete(articleId) {
    const marks = this.getAll()
    delete marks[articleId]
    writeJSON(KEYS.READING_MARKS, marks)
  },
}

// ─── 数据导出 / 导入 ──────────────────────────────────────────────────────────

export function exportData() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    articles: articleStore.getAll(),
    bookmarks: bookmarkStore.getAll(),
    readingMarks: readingMarkStore.getAll(),
  }
}

export function importData(data) {
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.articles) ||
    !Array.isArray(data.bookmarks)
  ) {
    throw new Error('无效的备份文件格式')
  }
  writeJSON(KEYS.ARTICLES, data.articles)
  writeJSON(KEYS.BOOKMARKS, data.bookmarks)
  if (data.readingMarks && typeof data.readingMarks === 'object') {
    writeJSON(KEYS.READING_MARKS, data.readingMarks)
  }
}

// ─── Article 工厂函数 ─────────────────────────────────────────────────────────

export function createArticle({ title, text, markdown = null }) {
  return {
    id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    text,
    markdown,
    createdAt: new Date().toISOString(),
    wordCount: text.split(/\s+/).filter(Boolean).length,
  }
}

// ─── Bookmark 工厂函数 ────────────────────────────────────────────────────────

export function createBookmark({
  type,           // 'word' | 'phrase' | 'sentence' | 'paragraph'
  text,           // 选中的原文
  contextSentence,      // 所在完整句（word/phrase 有值）
  articleId,
  paragraphIndex, // 所在段落索引
  charOffset,     // 在段落中的起始字符偏移量
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
    paragraphIndex,
    charOffset,
    createdAt: new Date().toISOString(),
    // 预留扩展字段（复习功能）
    reviewCount: 0,
    nextReviewAt: null,
    familiarity: 0, // 0-5
  }
}
