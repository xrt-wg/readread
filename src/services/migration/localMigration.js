import { exportData } from '../../store/storage'

export const MIGRATION_STEP_ORDER = ['articles', 'bookmarks', 'reading_marks']

export function getLocalMigrationSnapshot() {
  const exported = exportData()
  const summary = createLocalMigrationSummary(exported)

  return {
    ...exported,
    summary,
  }
}

export function createLocalMigrationSummary(snapshot) {
  const articles = Array.isArray(snapshot?.articles) ? snapshot.articles : []
  const bookmarks = Array.isArray(snapshot?.bookmarks) ? snapshot.bookmarks : []
  const readingMarks = snapshot?.readingMarks && typeof snapshot.readingMarks === 'object'
    ? snapshot.readingMarks
    : {}

  const articleCount = articles.length
  const bookmarkCount = bookmarks.length
  const readingMarkCount = Object.keys(readingMarks).length

  return {
    articleCount,
    bookmarkCount,
    readingMarkCount,
    hasData: articleCount > 0 || bookmarkCount > 0 || readingMarkCount > 0,
  }
}

export function validateLocalMigrationSnapshot(snapshot) {
  const errors = []
  const warnings = []
  const validArticleIds = new Set()
  const articleIds = new Set()
  const bookmarkIds = new Set()

  if (!Array.isArray(snapshot?.articles)) {
    errors.push('articles 必须为数组')
  }

  if (!Array.isArray(snapshot?.bookmarks)) {
    errors.push('bookmarks 必须为数组')
  }

  if (!snapshot?.readingMarks || typeof snapshot.readingMarks !== 'object' || Array.isArray(snapshot.readingMarks)) {
    errors.push('readingMarks 必须为对象')
  }

  if (Array.isArray(snapshot?.articles)) {
    snapshot.articles.forEach((article, index) => {
      const recordLabel = `articles[${index}]`

      if (!article?.id || !article?.title || !article?.text) {
        errors.push(`${recordLabel} 缺少必要字段`)
        return
      }

      if (articleIds.has(article.id)) {
        errors.push(`${recordLabel} 与其他文章重复使用 id ${article.id}`)
        return
      }

      articleIds.add(article.id)
      validArticleIds.add(article.id)
    })
  }

  if (Array.isArray(snapshot?.bookmarks)) {
    snapshot.bookmarks.forEach((bookmark, index) => {
      const recordLabel = `bookmarks[${index}]`

      if (!bookmark?.id || !bookmark?.articleId || !bookmark?.text || !bookmark?.type) {
        errors.push(`${recordLabel} 缺少必要字段`)
        return
      }

      if (bookmarkIds.has(bookmark.id)) {
        errors.push(`${recordLabel} 与其他收藏重复使用 id ${bookmark.id}`)
        return
      }

      if (!validArticleIds.has(bookmark.articleId)) {
        errors.push(`${recordLabel} 引用了不存在或无效的文章 ${bookmark.articleId}`)
        return
      }

      bookmarkIds.add(bookmark.id)
    })
  }

  if (snapshot?.readingMarks && typeof snapshot.readingMarks === 'object' && !Array.isArray(snapshot.readingMarks)) {
    Object.entries(snapshot.readingMarks).forEach(([articleId, mark]) => {
      const recordLabel = `readingMarks.${articleId || 'unknown'}`

      if (!articleId || !mark?.articleId) {
        errors.push(`${recordLabel} 缺少 articleId`)
        return
      }

      if (articleId !== mark.articleId) {
        warnings.push(`${recordLabel} 的键名与 articleId 不一致，将以记录内 articleId 为准`)
      }

      if (!validArticleIds.has(mark.articleId)) {
        errors.push(`${recordLabel} 引用了不存在或无效的文章 ${mark.articleId}`)
      }
    })
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

export function getLocalMigrationFieldMappings() {
  return {
    // 注：迁移 UI 已停用（silentImport 替代），以下映射作为备用参考
    articles: [
      ['id', 'id'],
      ['title', 'title'],
      ['text', 'text'],
      ['markdown', 'markdown'],
      ['wordCount', 'word_count'],
      ['createdAt', 'created_at'],
      ['(current user)', 'user_id'],
      ['manual', 'source_type'],
      ['author', 'author'],
      ['format', 'format'],
      ['coverUrl', 'cover_url'],
      ['lang', 'lang'],
      ['sourceUrl', 'source_url'],
      ['sections', 'sections'],
      ['sectionCount', 'section_count'],
    ],
    bookmarks: [
      ['id', 'id'],
      ['articleId', 'article_id'],
      ['type', 'type'],
      ['text', 'text'],
      ['translation', 'translation'],
      ['translationProvider', 'translation_provider'],
      ['contextSentence', 'context_sentence'],
      ['contextTranslation', 'context_translation'],
      ['translationStatus', 'translation_status'],
      ['paragraphIndex', 'paragraph_index'],
      ['charOffset', 'char_offset'],
      ['reviewCount', 'review_count'],
      ['nextReviewAt', 'next_review_at'],
      ['familiarity', 'familiarity'],
      ['createdAt', 'created_at'],
      ['(current user)', 'user_id'],
      ['sectionId', 'section_id'],
      ['sectionHeading', 'section_heading'],
    ],
    readingMarks: [
      ['articleId', 'article_id'],
      ['paragraphIndex', 'paragraph_index'],
      ['completed', 'completed'],
      ['updatedAt', 'updated_at'],
      ['(current user)', 'user_id'],
      ['sectionId', 'section_id'],
      ['completedSections', 'completed_sections'],
    ],
  }
}

export function buildLocalMigrationContract(userId) {
  const snapshot = getLocalMigrationSnapshot()
  const validation = validateLocalMigrationSnapshot(snapshot)

  return {
    userId,
    version: snapshot.version,
    exportedAt: snapshot.exportedAt,
    snapshot,
    summary: snapshot.summary,
    validation,
    mappings: getLocalMigrationFieldMappings(),
    stepOrder: MIGRATION_STEP_ORDER,
    readyToMigrate: snapshot.summary.hasData && validation.isValid,
  }
}

export function prepareLocalMigration(userId) {
  const contract = buildLocalMigrationContract(userId)

  return {
    ...contract,
    phase: contract.readyToMigrate ? 'ready' : 'failed',
  }
}
