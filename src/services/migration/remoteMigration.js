import { getSupabaseClient, markInitialMigrationCompleted } from '../supabase'
import { markLocalMigrationCompleted } from '../../store/storage'
import { prepareLocalMigration } from './localMigration'

function createStepResult() {
  return {
    success: 0,
    skipped: 0,
    failed: 0,
    warnings: [],
  }
}

function getFailedRecordsCount(results) {
  return results.articles.failed + results.bookmarks.failed + results.readingMarks.failed
}

function getMigrationWarnings(results) {
  return [
    ...results.articles.warnings,
    ...results.bookmarks.warnings,
    ...results.readingMarks.warnings,
  ]
}

function buildFailureSummary(results) {
  return {
    articles: results.articles.failed,
    bookmarks: results.bookmarks.failed,
    readingMarks: results.readingMarks.failed,
    total: getFailedRecordsCount(results),
  }
}

// 注：迁移 UI 已停用（silentImport 替代），以下仅为备用，已补充新字段映射
function mapArticleForInsert(article, userId) {
  return {
    id: article.id,
    user_id: userId,
    title: article.title,
    text: article.text,
    markdown: article.markdown ?? null,
    word_count: article.wordCount ?? 0,
    source_type: 'manual',
    source_url: article.sourceUrl ?? null,
    author: article.author ?? null,
    format: article.format ?? 'paste',
    cover_url: article.coverUrl ?? null,
    lang: article.lang ?? 'auto',
    sections: article.sections ?? [],
    section_count: article.sectionCount ?? 1,
    created_at: article.createdAt ?? new Date().toISOString(),
    updated_at: article.createdAt ?? new Date().toISOString(),
  }
}

function mapBookmarkForInsert(bookmark, userId) {
  return {
    id: bookmark.id,
    user_id: userId,
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
    created_at: bookmark.createdAt ?? new Date().toISOString(),
    updated_at: bookmark.createdAt ?? new Date().toISOString(),
  }
}

function mapReadingMarkForUpsert(readingMark, userId) {
  return {
    user_id: userId,
    article_id: readingMark.articleId,
    paragraph_index: readingMark.paragraphIndex ?? null,
    completed: Boolean(readingMark.completed),
    section_id: readingMark.sectionId ?? null,
    completed_sections: readingMark.completedSections ?? [],
    updated_at: readingMark.updatedAt ?? new Date().toISOString(),
  }
}

function isValidArticleRecord(article) {
  return Boolean(article?.id && article?.title && article?.text)
}

function isValidBookmarkRecord(bookmark) {
  return Boolean(bookmark?.id && bookmark?.articleId && bookmark?.text && bookmark?.type)
}

function isValidReadingMarkRecord(readingMark) {
  return Boolean(readingMark?.articleId)
}

function mergeReadingMark(localReadingMark, remoteReadingMark, userId) {
  const localUpdatedAt = new Date(localReadingMark.updatedAt ?? 0).getTime() || 0
  const remoteUpdatedAt = new Date(remoteReadingMark?.updated_at ?? remoteReadingMark?.created_at ?? 0).getTime() || 0
  const nextCompleted = Boolean(localReadingMark.completed) || Boolean(remoteReadingMark?.completed)
  const nextParagraphIndex = nextCompleted
    ? Math.max(localReadingMark.paragraphIndex ?? 0, remoteReadingMark?.paragraph_index ?? 0)
    : Math.max(localReadingMark.paragraphIndex ?? 0, remoteReadingMark?.paragraph_index ?? 0)

  return {
    user_id: userId,
    article_id: localReadingMark.articleId,
    paragraph_index: Number.isFinite(nextParagraphIndex) ? nextParagraphIndex : null,
    completed: nextCompleted,
    created_at: remoteReadingMark?.created_at ?? new Date().toISOString(),
    updated_at: new Date(Math.max(localUpdatedAt, remoteUpdatedAt, Date.now())).toISOString(),
  }
}

async function migrateArticles(client, snapshot, userId) {
  const result = createStepResult()
  const existingIds = new Set()

  if (snapshot.articles.length === 0) {
    return result
  }

  const articleIds = snapshot.articles
    .filter((article) => article?.id)
    .map((article) => article.id)

  if (articleIds.length > 0) {
    const { data, error } = await client
      .from('articles')
      .select('id')
      .eq('user_id', userId)
      .in('id', articleIds)

    if (error) {
      throw error
    }

    data.forEach((item) => existingIds.add(item.id))
  }

  for (const article of snapshot.articles) {
    if (!isValidArticleRecord(article)) {
      result.failed += 1
      result.warnings.push(`articles.${article?.id ?? 'unknown'} 字段不完整，已跳过`)
      continue
    }

    if (existingIds.has(article.id)) {
      result.skipped += 1
      result.warnings.push(`articles.${article.id} 已存在于云端，已跳过重复导入`)
      continue
    }

    const { error } = await client
      .from('articles')
      .insert(mapArticleForInsert(article, userId))

    if (error) {
      result.failed += 1
      result.warnings.push(`articles.${article.id} 写入失败：${error.message}`)
      continue
    }

    existingIds.add(article.id)
    result.success += 1
  }

  return result
}

async function migrateBookmarks(client, snapshot, userId) {
  const result = createStepResult()
  const existingIds = new Set()
  const existingArticleIds = new Set()

  if (snapshot.bookmarks.length === 0) {
    return result
  }

  const bookmarkIds = snapshot.bookmarks
    .filter((bookmark) => bookmark?.id)
    .map((bookmark) => bookmark.id)
  const articleIds = Array.from(new Set(snapshot.bookmarks
    .filter((bookmark) => bookmark?.articleId)
    .map((bookmark) => bookmark.articleId)))

  if (bookmarkIds.length > 0) {
    const { data, error } = await client
      .from('bookmarks')
      .select('id')
      .eq('user_id', userId)
      .in('id', bookmarkIds)

    if (error) {
      throw error
    }

    data.forEach((item) => existingIds.add(item.id))
  }

  if (articleIds.length > 0) {
    const { data, error } = await client
      .from('articles')
      .select('id')
      .eq('user_id', userId)
      .in('id', articleIds)

    if (error) {
      throw error
    }

    data.forEach((item) => existingArticleIds.add(item.id))
  }

  for (const bookmark of snapshot.bookmarks) {
    if (!isValidBookmarkRecord(bookmark)) {
      result.failed += 1
      result.warnings.push(`bookmarks.${bookmark?.id ?? 'unknown'} 字段不完整，已跳过`)
      continue
    }

    if (!existingArticleIds.has(bookmark.articleId)) {
      result.skipped += 1
      result.warnings.push(`bookmarks.${bookmark.id} 引用了不存在的文章 ${bookmark.articleId}，已跳过`)
      continue
    }

    if (existingIds.has(bookmark.id)) {
      result.skipped += 1
      result.warnings.push(`bookmarks.${bookmark.id} 已存在于云端，已跳过重复导入`)
      continue
    }

    const { error } = await client
      .from('bookmarks')
      .insert(mapBookmarkForInsert(bookmark, userId))

    if (error) {
      result.failed += 1
      result.warnings.push(`bookmarks.${bookmark.id} 写入失败：${error.message}`)
      continue
    }

    existingIds.add(bookmark.id)
    result.success += 1
  }

  return result
}

async function migrateReadingMarks(client, snapshot, userId) {
  const result = createStepResult()
  const readingMarks = Object.values(snapshot.readingMarks)
  const articleIds = Array.from(new Set(readingMarks
    .filter((readingMark) => readingMark?.articleId)
    .map((readingMark) => readingMark.articleId)))
  const existingArticleIds = new Set()

  if (readingMarks.length === 0) {
    return result
  }

  if (articleIds.length > 0) {
    const { data, error } = await client
      .from('articles')
      .select('id')
      .eq('user_id', userId)
      .in('id', articleIds)

    if (error) {
      throw error
    }

    data.forEach((item) => existingArticleIds.add(item.id))
  }

  for (const readingMark of readingMarks) {
    if (!isValidReadingMarkRecord(readingMark)) {
      result.failed += 1
      result.warnings.push('readingMarks.unknown 缺少 articleId，已跳过')
      continue
    }

    if (!existingArticleIds.has(readingMark.articleId)) {
      result.skipped += 1
      result.warnings.push(`readingMarks.${readingMark.articleId} 引用了不存在的文章，已跳过`)
      continue
    }

    const { data: remoteMark, error: remoteError } = await client
      .from('reading_marks')
      .select('user_id, article_id, paragraph_index, completed, created_at, updated_at')
      .eq('user_id', userId)
      .eq('article_id', readingMark.articleId)
      .maybeSingle()

    if (remoteError) {
      result.failed += 1
      result.warnings.push(`readingMarks.${readingMark.articleId} 读取云端状态失败：${remoteError.message}`)
      continue
    }

    const payload = mergeReadingMark(readingMark, remoteMark, userId)
    const { error } = await client
      .from('reading_marks')
      .upsert(payload, {
        onConflict: 'user_id,article_id',
        ignoreDuplicates: false,
      })

    if (error) {
      result.failed += 1
      result.warnings.push(`readingMarks.${readingMark.articleId} 写入失败：${error.message}`)
      continue
    }

    result.success += 1
  }

  return result
}

function buildSummaryCheck(prepared, results) {
  return {
    articles:
      prepared.summary.articleCount ===
      results.articles.success + results.articles.skipped + results.articles.failed,
    bookmarks:
      prepared.summary.bookmarkCount ===
      results.bookmarks.success + results.bookmarks.skipped + results.bookmarks.failed,
    readingMarks:
      prepared.summary.readingMarkCount ===
      results.readingMarks.success + results.readingMarks.skipped + results.readingMarks.failed,
  }
}

export async function runRemoteMigration(userId) {
  const prepared = prepareLocalMigration(userId)

  if (!prepared.readyToMigrate) {
    return {
      phase: 'failed',
      prepared,
      summary: prepared.summary,
      validation: prepared.validation,
      readyToMigrate: prepared.readyToMigrate,
      failedStep: 'precheck',
      warnings: prepared.validation.warnings ?? [],
      error: new Error('迁移预检查未通过，已阻断正式写入'),
    }
  }

  const client = getSupabaseClient()

  try {
    const articleResult = await migrateArticles(client, prepared.snapshot, userId)
    const bookmarkResult = await migrateBookmarks(client, prepared.snapshot, userId)
    const readingMarkResult = await migrateReadingMarks(client, prepared.snapshot, userId)
    const results = {
      articles: articleResult,
      bookmarks: bookmarkResult,
      readingMarks: readingMarkResult,
    }
    const summaryCheck = buildSummaryCheck(prepared, results)
    const warnings = getMigrationWarnings(results)
    const failureSummary = buildFailureSummary(results)

    if (failureSummary.total > 0) {
      return {
        phase: 'failed',
        prepared,
        summary: prepared.summary,
        validation: prepared.validation,
        readyToMigrate: prepared.readyToMigrate,
        failedStep: 'write',
        warnings,
        results,
        summaryCheck,
        failureSummary,
        error: new Error(`迁移执行未完全成功：共有 ${failureSummary.total} 条记录写入失败，已阻断迁移完成状态写回`),
      }
    }

    if (!summaryCheck.articles || !summaryCheck.bookmarks || !summaryCheck.readingMarks) {
      return {
        phase: 'failed',
        prepared,
        summary: prepared.summary,
        validation: prepared.validation,
        readyToMigrate: prepared.readyToMigrate,
        failedStep: 'validation',
        warnings,
        results,
        summaryCheck,
        failureSummary,
        error: new Error('迁移后校验失败：本地数量与迁移结果汇总不一致'),
      }
    }

    const profile = await markInitialMigrationCompleted()
    const localMigrationMeta = markLocalMigrationCompleted(userId)

    return {
      phase: 'completed',
      prepared,
      summary: prepared.summary,
      validation: prepared.validation,
      readyToMigrate: prepared.readyToMigrate,
      failedStep: null,
      warnings,
      results,
      summaryCheck,
      failureSummary,
      localMigrationMeta,
      profile,
    }
  } catch (error) {
    return {
      phase: 'failed',
      prepared,
      summary: prepared.summary,
      validation: prepared.validation,
      readyToMigrate: prepared.readyToMigrate,
      failedStep: 'write',
      warnings: [],
      failureSummary: null,
      error,
    }
  }
}
