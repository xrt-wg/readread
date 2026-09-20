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
