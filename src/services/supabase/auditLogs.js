import { getSupabaseClient } from './client'

const AUDIT_LOG_COLUMNS = 'id, actor_user_id, actor_role, action, target_type, target_id, payload, ip_address, created_at'

function mapAuditLogRow(row) {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    payload: row.payload,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
  }
}

async function getCurrentActorUserId() {
  const client = getSupabaseClient()
  const {
    data: { user },
    error,
  } = await client.auth.getUser()

  if (error) {
    throw error
  }

  if (!user?.id) {
    throw new Error('当前用户未登录，无法写入审计日志')
  }

  return user.id
}

export async function createAuditLog(input) {
  const client = getSupabaseClient()
  const actorUserId = await getCurrentActorUserId()
  const payload = {
    actor_user_id: actorUserId,
    actor_role: input.actorRole ?? 'admin',
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId ?? null,
    payload: input.payload ?? null,
    ip_address: input.ipAddress ?? null,
  }

  const { data, error } = await client
    .from('audit_logs')
    .insert(payload)
    .select(AUDIT_LOG_COLUMNS)
    .single()

  if (error) {
    throw error
  }

  return mapAuditLogRow(data)
}

export async function listAuditLogs() {
  const client = getSupabaseClient()
  let query = client
    .from('audit_logs')
    .select(AUDIT_LOG_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(50)

  const options = arguments[0] || {}
  const { action, targetType, createdFrom, createdTo, limit = 50 } = options

  query = query.limit(limit)

  if (action) {
    query = query.eq('action', action)
  }

  if (targetType) {
    query = query.eq('target_type', targetType)
  }

  if (createdFrom) {
    query = query.gte('created_at', createdFrom)
  }

  if (createdTo) {
    query = query.lte('created_at', createdTo)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return data.map(mapAuditLogRow)
}
