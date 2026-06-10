import { getSupabaseClient } from './client'

const ADMIN_PROFILE_COLUMNS = [
  'user_id',
  'display_name',
  'avatar_url',
  'status',
  'has_completed_initial_migration',
  'initial_migrated_at',
  'last_seen_at',
  'created_at',
  'updated_at',
].join(', ')

function mapAdminProfileRow(row) {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    status: row.status,
    hasCompletedInitialMigration: row.has_completed_initial_migration,
    initialMigratedAt: row.initial_migrated_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function ensureProfile() {
  const { data, error } = await getSupabaseClient().rpc('ensure_profile')

  if (error) {
    throw error
  }

  return data
}

export async function isCurrentUserAdmin() {
  const { data, error } = await getSupabaseClient().rpc('is_current_user_admin')

  if (error) {
    throw error
  }

  return Boolean(data)
}

export async function listAdminProfiles() {
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select(ADMIN_PROFILE_COLUMNS)
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return data.map(mapAdminProfileRow)
}

export async function markInitialMigrationCompleted() {
  const client = getSupabaseClient()
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser()

  if (userError) {
    throw userError
  }

  if (!user?.id) {
    throw new Error('当前用户未登录，无法更新迁移状态')
  }

  const now = new Date().toISOString()
  const { data, error } = await client
    .from('profiles')
    .update({
      has_completed_initial_migration: true,
      initial_migrated_at: now,
      last_seen_at: now,
    })
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    throw error
  }

  return data
}
