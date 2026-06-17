/**
 * 社区众包推荐系统 — 服务层
 *
 * 职责：推荐提交、评分、加入书架、资格校验、旧数据迁移
 * 自 2026-06-16 起取代 featuredArticles.js
 */

import { getSupabaseClient } from './client'
import { isLibraryAccessError, resolveLibraryErrorMessage } from '../errorUtils'
import { createImportItem } from '../importItems'

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const RECOMMENDATION_COLUMNS = [
  'id', 'submitter_user_id', 'import_item_id',
  'title', 'title_trans', 'author', 'source_url',
  'intro', 'keywords', 'keywords_trans',
  'excerpts', 'excerpts_trans',
  'add_count', 'recommend_score', 'status',
  'created_at', 'updated_at',
].join(', ')

const RATING_COLUMNS = 'submission_id, user_id, rating, created_at, updated_at'

const WEEKLY_SUBMIT_LIMIT = 1 // 每人每周最多提交推荐数（远期可配置化）

// ─── 行映射 ────────────────────────────────────────────────────────────────────

function mapRecommendationRow(row) {
  return {
    id:              row.id,
    submitterUserId: row.submitter_user_id,
    importItemId:    row.import_item_id,
    title:           row.title,
    titleTrans:      row.title_trans,
    author:          row.author,
    sourceUrl:       row.source_url,
    intro:           row.intro,
    keywords:        row.keywords,
    keywordsTrans:   row.keywords_trans,
    excerpts:        row.excerpts,
    excerptsTrans:   row.excerpts_trans,
    addCount:        row.add_count,
    recommendScore:  row.recommend_score,
    status:          row.status,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  }
}

function mapRatingRow(row) {
  return {
    submissionId: row.submission_id,
    userId:       row.user_id,
    rating:       row.rating,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  }
}

// ─── 内部辅助 ──────────────────────────────────────────────────────────────────

function getClient() {
  return getSupabaseClient()
}

async function getCurrentUserId() {
  const client = getClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error) throw error
  if (!user?.id) throw new Error('当前用户未登录')
  return user.id
}

function generateId(prefix) {
  return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// ─── 查询 ──────────────────────────────────────────────────────────────────────

/**
 * 获取推荐列表（公开，含匿名用户）。
 * 默认按 recommend_score DESC 排序，仅返回 status='active' 条目。
 */
export async function listRecommendations({ limit = 20, offset = 0, sort = 'score' } = {}) {
  const client = getClient()
  let query = client
    .from('recommendation_submissions')
    .select(RECOMMENDATION_COLUMNS, { count: 'exact' })
    .eq('status', 'active')
    .order('recommend_score', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const { data, error, count } = await query
  if (error) throw error

  return {
    items: (data || []).map(mapRecommendationRow),
    total: count ?? 0,
  }
}

/**
 * 获取单个推荐条目的详情（含评分分布）。
 */
export async function getRecommendation(submissionId) {
  const client = getClient()
  const { data, error } = await client
    .from('recommendation_submissions')
    .select(RECOMMENDATION_COLUMNS)
    .eq('id', submissionId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  // 查询评分分布
  const { data: ratings } = await client
    .from('recommendation_ratings')
    .select(RATING_COLUMNS)
    .eq('submission_id', submissionId)

  return {
    submission: mapRecommendationRow(data),
    ratings: (ratings || []).map(mapRatingRow),
  }
}

/**
 * 获取用户自己的推荐提交列表。
 */
export async function listMySubmissions(userId) {
  const client = getClient()
  const { data, error } = await client
    .from('recommendation_submissions')
    .select(RECOMMENDATION_COLUMNS)
    .eq('submitter_user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []).map(mapRecommendationRow)
}

/**
 * 获取用户对某个推荐条目的当前评分。
 */
export async function getMyRating(submissionId, userId) {
  const client = getClient()
  const { data, error } = await client
    .from('recommendation_ratings')
    .select(RATING_COLUMNS)
    .eq('submission_id', submissionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return data ? mapRatingRow(data) : null
}

// ─── 内部辅助查询 ──────────────────────────────────────────────────────────────

async function getSubmissionById(submissionId) {
  const client = getClient()
  const { data, error } = await client
    .from('recommendation_submissions')
    .select(RECOMMENDATION_COLUMNS)
    .eq('id', submissionId)
    .maybeSingle()

  if (error) throw error
  return data ? mapRecommendationRow(data) : null
}

async function findImportItemByShareSource(userId, submissionId) {
  const client = getClient()
  const { data, error } = await client
    .from('import_items')
    .select('id')
    .eq('user_id', userId)
    .eq('share_source_id', submissionId)
    .in('origin', ['featured', 'featured_legacy'])
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  return !!data
}

async function countWeeklySubmissions(userId) {
  const client = getClient()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await client
    .from('recommendation_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('submitter_user_id', userId)
    .gte('created_at', sevenDaysAgo)

  if (error) throw error
  return count ?? 0
}

async function checkDuplicateSubmission(item) {
  const client = getClient()
  // 优先按 source_url 去重（更精确）
  if (item.sourceUrl) {
    const { data } = await client
      .from('recommendation_submissions')
      .select('id')
      .eq('source_url', item.sourceUrl)
      .eq('status', 'active')
      .maybeSingle()
    if (data) return true
  }
  // source_url 为 NULL 时，仅按 title 去重
  const { data } = await client
    .from('recommendation_submissions')
    .select('id')
    .eq('title', item.title)
    .eq('status', 'active')
    .maybeSingle()
  return !!data
}

// ─── 校验函数 ──────────────────────────────────────────────────────────────────

/**
 * 检查用户是否已完成对某个 import_item 对应文章的阅读。
 * 通过 SECURITY DEFINER RPC 执行单条 SQL JOIN 查询。
 */
async function checkReadingCompleted(userId, importItemId) {
  const client = getClient()
  const { data, error } = await client.rpc('check_import_item_reading_completed', {
    p_import_item_id: importItemId,
    p_user_id: userId,
  })
  if (error) throw error
  return data === true
}

/**
 * 检查用户对某个 import_item 的提交资格。
 * 返回 { canSubmit: boolean, reason?: string }
 */
export async function checkSubmissionEligibility(userId, importItemId) {
  // 1. 获取 import_item
  const client = getClient()
  const { data: item } = await client
    .from('import_items')
    .select('id, user_id, origin, title, source_url')
    .eq('id', importItemId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!item) return { canSubmit: false, reason: '素材不存在' }
  if (item.user_id !== userId) return { canSubmit: false, reason: '无权操作此素材' }

  // 2. origin 检查
  if (item.origin !== 'imported') {
    return { canSubmit: false, reason: '仅自导入内容可提交推荐' }
  }

  // 3. 检查是否已读完
  const isCompleted = await checkReadingCompleted(userId, importItemId)
  if (!isCompleted) {
    return { canSubmit: false, reason: '请先完成阅读后再提交推荐' }
  }

  // 4. 本周提交数检查
  const weeklyCount = await countWeeklySubmissions(userId)
  if (weeklyCount >= WEEKLY_SUBMIT_LIMIT) {
    return {
      canSubmit: false,
      reason: `本周已提交 ${weeklyCount}/${WEEKLY_SUBMIT_LIMIT} 篇，下周再来`,
      weeklyCount,
    }
  }

  // 5. 重复提交检查
  const duplicate = await checkDuplicateSubmission({ sourceUrl: item.source_url, title: item.title })
  if (duplicate) {
    return { canSubmit: false, reason: '该内容已被推荐过' }
  }

  return { canSubmit: true }
}

/**
 * 检查用户对某个推荐条目的评分资格。
 * 返回 { canRate: boolean, reason?: string }
 */
export async function checkRatingEligibility(userId, submissionId) {
  // 1. 用户是否通过该推荐加入过书架？
  const hasAdded = await findImportItemByShareSource(userId, submissionId)
  if (!hasAdded) return { canRate: false, reason: '你还没有添加这篇推荐内容' }

  // 2. 获取 import_item 检查是否已读完
  const client = getClient()
  const { data: importItem } = await client
    .from('import_items')
    .select('id')
    .eq('user_id', userId)
    .eq('share_source_id', submissionId)
    .in('origin', ['featured', 'featured_legacy'])
    .is('deleted_at', null)
    .maybeSingle()

  if (!importItem) return { canRate: false, reason: '推荐内容已不在书架中' }

  // 3. 是否已读完？
  const isCompleted = await checkReadingCompleted(userId, importItem.id)
  if (!isCompleted) return { canRate: false, reason: '请先完成阅读后再评分' }

  return { canRate: true }
}

// ─── 写入 ──────────────────────────────────────────────────────────────────────

/**
 * 将书架上一个已完成的 import_item 提交到推荐区。
 *
 * 前置校验（应用层——调用前应已通过 checkSubmissionEligibility）：
 *   1. import_item.origin === 'imported'
 *   2. 对应的 reading_marks.completed === true
 *   3. 本周提交数 < WEEKLY_SUBMIT_LIMIT
 *   4. source_url 或 title 未被重复提交
 *   5. intro 和 excerpt 非空
 */
export async function submitRecommendation(
  { importItemId, intro, keywords, excerpts, titleTrans, keywordsTrans, excerptsTrans },
  userId
) {
  const client = getClient()

  // 1. 读取 import_item 快照字段
  const { data: item, error: itemError } = await client
    .from('import_items')
    .select('title, author, source_url')
    .eq('id', importItemId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single()

  if (itemError) throw itemError

  // 2. 创建推荐条目
  const submission = {
    id:                generateId('rec_'),
    submitter_user_id: userId,
    import_item_id:    importItemId,
    title:             item.title,
    title_trans:       titleTrans?.trim() || null,
    author:            item.author ?? null,
    source_url:        item.source_url ?? null,
    intro:             intro.trim(),
    keywords:          keywords || [],
    keywords_trans:    keywordsTrans || null,
    excerpts:          excerpts.filter(e => e.trim()),
    excerpts_trans:    excerptsTrans?.filter(e => e.trim()) || null,
    add_count:         0,
    recommend_score:   0,
    status:            'active',
  }

  const { data, error } = await client
    .from('recommendation_submissions')
    .insert(submission)
    .select(RECOMMENDATION_COLUMNS)
    .single()

  if (error) throw error
  return mapRecommendationRow(data)
}

/**
 * 从推荐区加入用户书架。
 * 跨用户深拷贝 import_item 内容。
 * 核心步骤通过 SECURITY DEFINER RPC 绕过 RLS。
 */
export async function addRecommendationToBookshelf(submissionId, userId) {
  const client = getClient()

  // 1. 获取推荐条目
  const submission = await getSubmissionById(submissionId)
  if (!submission || submission.status !== 'active') {
    const err = new Error('该推荐内容当前不可用')
    err.code = 'SUBMISSION_UNAVAILABLE'
    throw err
  }

  // 2. 跨用户获取提交者的 import_item（SECURITY DEFINER RPC）
  const { data: row, error: rpcError } = await client.rpc(
    'get_import_item_for_recommendation',
    { p_import_item_id: submission.importItemId }
  )
  if (rpcError) throw rpcError
  // RPC 返回单行 JSONB，需要映射
  const sourceItem = row

  // 3. 深拷贝 sections（跨用户独立副本）
  const sections = structuredClone(sourceItem.sections || [])

  // 4. 构造新 import_item（复用 createImportItem 工厂函数）
  const importItem = await createImportItem(
    {
      meta: {
        title:     sourceItem.title,
        author:    sourceItem.author,
        format:    sourceItem.format || 'markdown',
        coverUrl:  sourceItem.cover_url,
        lang:      sourceItem.lang || 'auto',
        sourceUrl: sourceItem.source_url,
      },
      sections: sections.map(s => ({
        heading:  s.heading,
        depth:    s.depth,
        order:    s.order,
        body: {
          text:     s.body?.text || '',
          markdown: s.body?.markdown || null,
        },
      })),
    },
    {
      userId,
      origin: 'featured',
      shareSourceId: submissionId,
    }
  )

  // 5. 更新 add_count + recommend_score（SECURITY DEFINER RPC）
  const { error: countError } = await client.rpc(
    'increment_recommendation_add_count',
    {
      p_submission_id: submissionId,
      p_user_id: userId,
    }
  )
  if (countError) throw countError

  return importItem
}

/**
 * 更新自己的推荐条目（intro / keywords / excerpts / *_trans）。
 */
export async function updateRecommendation(submissionId, patch, userId) {
  const client = getClient()
  const dbPatch = {}
  if (patch.intro !== undefined) dbPatch.intro = patch.intro.trim()
  if (patch.keywords !== undefined) dbPatch.keywords = patch.keywords
  if (patch.excerpts !== undefined) dbPatch.excerpts = patch.excerpts.filter(e => e.trim())
  if (patch.titleTrans !== undefined) dbPatch.title_trans = patch.titleTrans?.trim() || null
  if (patch.keywordsTrans !== undefined) dbPatch.keywords_trans = patch.keywordsTrans || null
  if (patch.excerptsTrans !== undefined) dbPatch.excerpts_trans = patch.excerptsTrans?.filter(e => e.trim()) || null
  if (patch.status !== undefined) dbPatch.status = patch.status

  const { data, error } = await client
    .from('recommendation_submissions')
    .update(dbPatch)
    .eq('id', submissionId)
    .eq('submitter_user_id', userId)
    .select(RECOMMENDATION_COLUMNS)
    .single()

  if (error) throw error
  return mapRecommendationRow(data)
}

/**
 * 下架自己的推荐条目（status = 'removed'）。
 */
export async function removeRecommendation(submissionId, userId) {
  return updateRecommendation(submissionId, { status: 'removed' }, userId)
}

/**
 * 当用户删除书架上的 import_item 时，更新相关推荐的 add_count。
 * 应在 deleteImportItem RPC 调用后执行。
 */
export async function syncAddCountAfterDelete(importItem) {
  const client = getClient()
  if (
    (importItem.origin === 'featured' || importItem.origin === 'featured_legacy') &&
    importItem.shareSourceId
  ) {
    const { error } = await client.rpc('increment_recommendation_add_count', {
      p_submission_id: importItem.shareSourceId,
      p_user_id: importItem.userId,
    })
    if (error) {
      console.warn('推荐 add_count 同步失败（非致命）:', error.message)
    }
  }
}

// ─── 评分 ──────────────────────────────────────────────────────────────────────

/**
 * 对推荐条目评分（UPSERT 语义——创建或更新）。
 *
 * 前置校验（应用层——调用前应已通过 checkRatingEligibility）：
 *   1. 用户有 import_items 满足 origin='featured'/origin='featured_legacy' AND share_source_id=submissionId
 *   2. 对应 reading_marks.completed = true
 */
export async function rateRecommendation(submissionId, rating, userId) {
  const client = getClient()

  const ratingRow = {
    submission_id: submissionId,
    user_id: userId,
    rating,
  }

  // UPSERT: 使用 ON CONFLICT 的 upsert 语义通过 Supabase
  const { data, error } = await client
    .from('recommendation_ratings')
    .upsert(ratingRow, {
      onConflict: 'submission_id, user_id',
      ignoreDuplicates: false,
    })
    .select(RATING_COLUMNS)
    .single()

  if (error) throw error
  return mapRatingRow(data)
}

// ─── 种子数据 ──────────────────────────────────────────────────────────────────

/**
 * 迁移旧 featured_articles 种子数据到新推荐模型。
 * 仅执行一次——检测 system 账号的 import_items 是否已存在。
 */
export async function migrateLegacyFeaturedArticles() {
  const client = getClient()
  const systemUserId = '00000000-0000-0000-0000-000000000000'
  const migrated = []
  const skipped = []

  // 1. 读取旧 featured_articles 表（如果还存在）
  let legacyArticles = []
  try {
    const { data, error } = await client
      .from('featured_articles')
      .select('*')
      .is('deleted_at', null)
      .eq('status', 'published')

    if (!error && data) {
      legacyArticles = data
    }
  } catch (_) {
    // featured_articles 表可能已被 DROP——跳过
    return { migratedArticles: [], migratedCount: 0, skippedCount: 0, message: '旧 featured_articles 表不存在或已清理' }
  }

  if (legacyArticles.length === 0) {
    return { migratedArticles: [], migratedCount: 0, skippedCount: 0, message: '无待迁移数据' }
  }

  for (const legacy of legacyArticles) {
    // 检查是否已迁移（通过 title + source 匹配）
    const { data: existing } = await client
      .from('recommendation_submissions')
      .select('id')
      .eq('title', legacy.title)
      .eq('status', 'active')
      .maybeSingle()

    if (existing) {
      skipped.push(legacy.title)
      continue
    }

    // 2. 创建 import_item
    const importItemId = generateId('imp_')
    const section = {
      id: 's_0',
      heading: null,
      depth: 0,
      parentId: null,
      order: 0,
      body: {
        text: legacy.text || '',
        markdown: legacy.markdown || null,
        wordCount: (legacy.text || '').split(/\s+/).filter(Boolean).length,
      },
    }

    const { error: impError } = await client
      .from('import_items')
      .insert({
        id: importItemId,
        user_id: systemUserId,
        title: legacy.title,
        author: null,
        format: 'markdown',
        cover_url: legacy.cover_image_url || null,
        lang: 'en',
        source_url: null,
        sections: [section],
        total_word_count: section.body.wordCount,
        section_count: 1,
        kind: 'article',
        origin: 'featured_legacy',
        share_status: 'private',
      })

    if (impError) {
      skipped.push(legacy.title)
      continue
    }

    // 3. 创建 recommendation_submission
    const keywords = legacy.source
      ? [legacy.source.replace(/\.com$/, '').replace(/^www\./, '')]
      : []

    const { data: sub, error: subError } = await client
      .from('recommendation_submissions')
      .insert({
        id: generateId('rec_'),
        submitter_user_id: systemUserId,
        import_item_id: importItemId,
        title: legacy.title,
        author: null,
        source_url: null,
        intro: legacy.description || '',
        keywords,
        excerpts: [(legacy.text || '').slice(0, 300)],
        add_count: 0,
        recommend_score: 0,
        status: 'active',
      })
      .select(RECOMMENDATION_COLUMNS)
      .single()

    if (subError) {
      skipped.push(legacy.title)
      continue
    }

    migrated.push(mapRecommendationRow(sub))
  }

  return {
    migratedArticles: migrated,
    migratedCount: migrated.length,
    skippedCount: skipped.length,
  }
}

// ─── 统计 ──────────────────────────────────────────────────────────────────────

/**
 * 获取推荐区全局统计。
 */
export async function getRecommendationStats() {
  const client = getClient()

  const { count: totalSubmissions } = await client
    .from('recommendation_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')

  const { count: totalRatings } = await client
    .from('recommendation_ratings')
    .select('submission_id', { count: 'exact', head: true })

  return {
    totalSubmissions: totalSubmissions ?? 0,
    totalRatings: totalRatings ?? 0,
  }
}
