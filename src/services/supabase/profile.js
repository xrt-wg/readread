import { getSupabaseClient } from './client'

const ADMIN_PROFILE_COLUMNS = [
  'user_id',
  'display_name',
  'avatar_url',
  'status',
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
