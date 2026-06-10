import { getSupabaseClient } from './client'
import { createAuditLog } from './auditLogs'
import { FEATURED_ARTICLE_SEEDS } from '../../seeds/featuredArticleSeeds'

const FEATURED_ARTICLE_COLUMNS = [
  'id',
  'title',
  'source',
  'description',
  'text',
  'markdown',
  'cover_image_url',
  'status',
  'sort_order',
  'published_at',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at',
  'deleted_at',
].join(', ')

function mapFeaturedArticleRow(row) {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    description: row.description,
    text: row.text,
    markdown: row.markdown,
    coverImageUrl: row.cover_image_url,
    status: row.status,
    sortOrder: row.sort_order,
    publishedAt: row.published_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

async function tryCreateAuditLog(input) {
  try {
    await createAuditLog(input)
    return null
  } catch (error) {
    return error.message || '审计日志写入失败'
  }
}

function createFeaturedArticleId() {
  return `featured_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

async function getCurrentUserId() {
  const client = getSupabaseClient()
  const {
    data: { user },
    error,
  } = await client.auth.getUser()

  if (error) {
    throw error
  }

  if (!user?.id) {
    throw new Error('当前用户未登录，无法管理推荐内容')
  }

  return user.id
}

function mapFeaturedArticleForWrite(input, userId, currentStatus = null) {
  const nextStatus = input.status ?? currentStatus ?? 'draft'
  const publishedAt = nextStatus === 'published'
    ? input.publishedAt ?? new Date().toISOString()
    : null

  return {
    id: input.id,
    title: input.title?.trim() || '未命名推荐内容',
    source: input.source?.trim() || null,
    description: input.description?.trim() || null,
    text: input.text,
    markdown: input.markdown?.trim() || null,
    cover_image_url: input.coverImageUrl?.trim() || null,
    status: nextStatus,
    sort_order: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
    published_at: publishedAt,
    updated_by: userId,
    deleted_at: null,
  }
}

export async function listFeaturedArticles(options = {}) {
  const { includeArchived = false, status } = options
  const client = getSupabaseClient()
  let query = client
    .from('featured_articles')
    .select(FEATURED_ARTICLE_COLUMNS)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  if (!includeArchived && !status) {
    query = query.in('status', ['draft', 'published'])
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return data.map(mapFeaturedArticleRow)
}

export async function seedBuiltInFeaturedArticles() {
  const client = getSupabaseClient()
  const userId = await getCurrentUserId()
  const builtInIds = FEATURED_ARTICLE_SEEDS.map((article) => article.id)
  const { data: existingRows, error: existingError } = await client
    .from('featured_articles')
    .select('id')
    .in('id', builtInIds)

  if (existingError) {
    throw existingError
  }

  const existingIds = new Set((existingRows || []).map((row) => row.id))
  const pendingArticles = FEATURED_ARTICLE_SEEDS
    .filter((article) => !existingIds.has(article.id))
    .map((article, index) => {
      const status = article.status ?? 'published'

      return {
        ...mapFeaturedArticleForWrite(
          {
            ...article,
            sortOrder: article.sortOrder ?? index + 1,
            status,
            publishedAt: status === 'published' ? new Date().toISOString() : null,
          },
          userId,
          status
        ),
        id: article.id,
        created_by: userId,
      }
    })

  if (pendingArticles.length === 0) {
    return {
      createdArticles: [],
      createdCount: 0,
      skippedCount: FEATURED_ARTICLE_SEEDS.length,
      auditWarning: null,
    }
  }

  const { data, error } = await client
    .from('featured_articles')
    .insert(pendingArticles)
    .select(FEATURED_ARTICLE_COLUMNS)

  if (error) {
    throw error
  }

  const createdArticles = data.map(mapFeaturedArticleRow)
  const auditWarning = await tryCreateAuditLog({
    action: 'featured_article.seed_builtin',
    targetType: 'featured_article',
    payload: {
      created_count: createdArticles.length,
      created_ids: createdArticles.map((article) => article.id),
      skipped_count: FEATURED_ARTICLE_SEEDS.length - createdArticles.length,
    },
  })

  return {
    createdArticles,
    createdCount: createdArticles.length,
    skippedCount: FEATURED_ARTICLE_SEEDS.length - createdArticles.length,
    auditWarning,
  }
}

export async function createFeaturedArticle(input) {
  const client = getSupabaseClient()
  const userId = await getCurrentUserId()
  const payload = {
    ...mapFeaturedArticleForWrite(
      {
        ...input,
        id: createFeaturedArticleId(),
      },
      userId
    ),
    created_by: userId,
  }

  const { data, error } = await client
    .from('featured_articles')
    .insert(payload)
    .select(FEATURED_ARTICLE_COLUMNS)
    .single()

  if (error) {
    throw error
  }

  const auditWarning = await tryCreateAuditLog({
    action: 'featured_article.create',
    targetType: 'featured_article',
    targetId: data.id,
    payload: {
      after: {
        id: data.id,
        title: data.title,
        status: data.status,
        sort_order: data.sort_order,
      },
    },
  })

  return {
    ...mapFeaturedArticleRow(data),
    auditWarning,
  }
}

export async function updateFeaturedArticle(input) {
  const client = getSupabaseClient()
  const userId = await getCurrentUserId()
  const { data: beforeData } = await client
    .from('featured_articles')
    .select(FEATURED_ARTICLE_COLUMNS)
    .eq('id', input.id)
    .is('deleted_at', null)
    .single()
  const payload = mapFeaturedArticleForWrite(input, userId, input.status)

  const { data, error } = await client
    .from('featured_articles')
    .update(payload)
    .eq('id', input.id)
    .is('deleted_at', null)
    .select(FEATURED_ARTICLE_COLUMNS)
    .single()

  if (error) {
    throw error
  }

  const auditWarning = await tryCreateAuditLog({
    action: 'featured_article.update',
    targetType: 'featured_article',
    targetId: data.id,
    payload: {
      before: beforeData
        ? {
            id: beforeData.id,
            title: beforeData.title,
            status: beforeData.status,
            sort_order: beforeData.sort_order,
          }
        : null,
      after: {
        id: data.id,
        title: data.title,
        status: data.status,
        sort_order: data.sort_order,
      },
    },
  })

  return {
    ...mapFeaturedArticleRow(data),
    auditWarning,
  }
}

export async function changeFeaturedArticleStatus(articleId, status) {
  const client = getSupabaseClient()
  const userId = await getCurrentUserId()
  const { data: beforeData } = await client
    .from('featured_articles')
    .select(FEATURED_ARTICLE_COLUMNS)
    .eq('id', articleId)
    .is('deleted_at', null)
    .single()
  const payload = {
    status,
    updated_by: userId,
    published_at: status === 'published' ? new Date().toISOString() : null,
  }

  const { data, error } = await client
    .from('featured_articles')
    .update(payload)
    .eq('id', articleId)
    .is('deleted_at', null)
    .select(FEATURED_ARTICLE_COLUMNS)
    .single()

  if (error) {
    throw error
  }

  const auditWarning = await tryCreateAuditLog({
    action: `featured_article.${status}`,
    targetType: 'featured_article',
    targetId: data.id,
    payload: {
      before: beforeData
        ? {
            id: beforeData.id,
            title: beforeData.title,
            status: beforeData.status,
          }
        : null,
      after: {
        id: data.id,
        title: data.title,
        status: data.status,
      },
    },
  })

  return {
    ...mapFeaturedArticleRow(data),
    auditWarning,
  }
}
