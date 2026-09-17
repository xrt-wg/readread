/**
 * 社区众包推荐系统 — 服务层
 *
 * 职责：推荐提交、评分、加入书架、资格校验、旧数据迁移
 * 自 2026-06-16 起取代 featuredArticles.js
 */

import { getSupabaseClient } from './client'
import { isLibraryAccessError, resolveLibraryErrorMessage } from '../errorUtils'
import { createReading as createImportItem } from '../readings'

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const RECOMMENDATION_COLUMNS = [
  'id', 'submitter_user_id', 'reading_id',
  'title', 'title_trans', 'author', 'source_url',
  'intro', 'keywords', 'keywords_trans',
  'excerpts', 'excerpts_trans',
  'add_count', 'recommend_score', 'status',
  'rejection_reason', 'rejection_at', 'removal_reason', 'removed_at',
  'approved_at', 'first_published_at', 'published_at',
  'created_at', 'updated_at',
].join(', ')

const RATING_COLUMNS = 'submission_id, user_id, rating, created_at, updated_at'

// ─── 行映射 ────────────────────────────────────────────────────────────────────

function mapRecommendationRow(row) {
  return {
    id:              row.id,
    submitterUserId: row.submitter_user_id,
    readingId:      row.reading_id,
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
    rejectionReason: row.rejection_reason,
    rejectionAt:     row.rejection_at,
    removalReason:   row.removal_reason,
    removedAt:       row.removed_at,
    approvedAt:      row.approved_at,
    firstPublishedAt: row.first_published_at,
    publishedAt:     row.published_at,
    internalNote:    row.internal_note,
    snapshotMissing: row.snapshot_missing === true,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  }
}

/** 返回当前用户可提交审核的已读完自导入内容。 */
export async function listSubmittableReadings() {
  const client = getClient()
  const { data, error } = await client.rpc('list_submittable_readings')
  if (error) throw error
  return data || []
}

/** 创建待审核推荐；资格校验、去重和正文快照均由服务端事务完成。 */
export async function submitRecommendationForReview({ readingId, title, author, sourceUrl }) {
  const client = getClient()
  const { data, error } = await client.rpc('submit_recommendation_for_review', {
    p_reading_id: readingId,
    p_title: title || null,
    p_author: author || null,
    p_source_url: sourceUrl || null,
  })
  if (error) throw error
  return mapRecommendationRow(data)
}

/** 管理员审核队列；内部备注只能通过该受控 RPC 返回。 */
export async function listRecommendationModerationQueue() {
  const client = getClient()
  const { data, error } = await client.rpc('admin_list_recommendation_submissions')
  if (error) throw error
  return (data || []).map(mapRecommendationRow)
}

export async function getRecommendationModerationDetail(submissionId) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_get_recommendation_submission_detail', { p_submission_id: submissionId })
  if (error) throw error
  return data ? { ...data, submission: mapRecommendationRow(data.submission) } : null
}

/** 管理员保存人工填写的推荐信息；已发布内容须先下架。 */
export async function updateRecommendationEditorial(submissionId, patch) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_update_recommendation_editorial', {
    p_submission_id: submissionId,
    p_title: patch.title?.trim() || null,
    p_author: patch.author?.trim() || null,
    p_source_url: patch.sourceUrl?.trim() || null,
    p_intro: patch.intro?.trim() || '',
    p_keywords: (patch.keywords || []).filter(Boolean),
    p_keywords_trans: (patch.keywordsTrans || []).filter(Boolean),
    p_excerpts: (patch.excerpts || []).filter(Boolean),
    p_excerpts_trans: (patch.excerptsTrans || []).filter(Boolean),
    p_internal_note: patch.internalNote?.trim() || null,
  })
  if (error) throw error
  return mapRecommendationRow(data)
}

async function runRecommendationAdminAction(functionName, args) {
  const client = getClient()
  const { data, error } = await client.rpc(functionName, args)
  if (error) throw error
  return mapRecommendationRow(data)
}

export function approveRecommendation(submissionId, internalNote = null) {
  return runRecommendationAdminAction('admin_approve_recommendation', { p_submission_id: submissionId, p_internal_note: internalNote })
}

export function rejectRecommendation(submissionId, rejectionReason, internalNote = null) {
  return runRecommendationAdminAction('admin_reject_recommendation', { p_submission_id: submissionId, p_rejection_reason: rejectionReason.trim(), p_internal_note: internalNote })
}

export function publishRecommendation(submissionId, internalNote = null) {
  return runRecommendationAdminAction('admin_publish_recommendation', { p_submission_id: submissionId, p_internal_note: internalNote })
}

export function removePublishedRecommendation(submissionId, removalReason, internalNote = null) {
  return runRecommendationAdminAction('admin_remove_recommendation', { p_submission_id: submissionId, p_removal_reason: removalReason.trim(), p_internal_note: internalNote })
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

  const [subResult, ratingsResult] = await Promise.all([
    client.from('recommendation_submissions')
      .select(RECOMMENDATION_COLUMNS)
      .eq('id', submissionId)
      .maybeSingle(),
    client.from('recommendation_ratings')
      .select(RATING_COLUMNS)
      .eq('submission_id', submissionId),
  ])

  if (subResult.error) throw subResult.error
  if (!subResult.data) return null

  return {
    submission: mapRecommendationRow(subResult.data),
    ratings: (ratingsResult.data || []).map(mapRatingRow),
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
    .from('readings')
    .select('id')
    .eq('user_id', userId)
    .eq('share_source_id', submissionId)
    .in('origin', ['featured', 'featured_legacy'])
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  return data?.id ?? null
}

// ─── 校验函数 ──────────────────────────────────────────────────────────────────

/**
 * 检查用户是否已完成对某个 import_item 对应文章的阅读。
 * 通过 SECURITY DEFINER RPC 执行单条 SQL JOIN 查询。
 */
async function checkReadingCompleted(userId, importItemId) {
  const client = getClient()
  const { data, error } = await client.rpc('check_reading_completed', {
    p_reading_id: importItemId,
    p_user_id: userId,
  })
  if (error) throw error
  return data === true
}

/**
 * 检查用户对某个推荐条目的评分资格。
 * 返回 { canRate: boolean, reason?: string }
 */
export async function checkRatingEligibility(userId, submissionId) {
  // 1. 查找书架中对应 import_item（返回 id 或 null）
  const importItemId = await findImportItemByShareSource(userId, submissionId)
  if (!importItemId) return { canRate: false, reason: '你还没有添加这篇推荐内容' }

  // 2. 是否已读完？
  const isCompleted = await checkReadingCompleted(userId, importItemId)
  if (!isCompleted) return { canRate: false, reason: '请先完成阅读后再评分' }

  return { canRate: true }
}

/**
 * 从推荐区加入用户书架。
 * 跨用户深拷贝 import_item 内容。
 * 核心步骤通过 SECURITY DEFINER RPC 绕过 RLS。
 */
export async function addRecommendationToBookshelf(submissionId, userId, { canUseCloudLibrary } = {}) {
  const client = getClient()

  // 1. 获取推荐条目
  const submission = await getSubmissionById(submissionId)
  if (!submission || submission.status !== 'active') {
    const err = new Error('该推荐内容当前不可用')
    err.code = 'SUBMISSION_UNAVAILABLE'
    throw err
  }

  // 2. 读取提交时的不可变快照（而非提交者后续可能编辑或删除的原书架内容）
  const { data: row, error: rpcError } = await client.rpc(
    'get_recommendation_snapshot',
    { p_submission_id: submissionId }
  )
  if (rpcError) throw rpcError
  if (!row?.sections) {
    const error = new Error('该内容暂未开放加入书架，请等待运营补录正文快照')
    error.code = 'RECOMMENDATION_SNAPSHOT_UNAVAILABLE'
    throw error
  }
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
      canUseCloudLibrary,
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
      .from('readings')
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
        reading_id: importItemId,
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

  const [subResult, ratingResult] = await Promise.all([
    client.from('recommendation_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    client.from('recommendation_ratings')
      .select('submission_id', { count: 'exact', head: true }),
  ])

  return {
    totalSubmissions: subResult.count ?? 0,
    totalRatings: ratingResult.count ?? 0,
  }
}
