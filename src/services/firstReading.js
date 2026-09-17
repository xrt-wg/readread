import { getSupabaseClient } from './supabase/client'

async function call(name, args) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const { data, error } = await getSupabaseClient().rpc(name, args).abortSignal(controller.signal)
    if (error) throw error
    return data
  } finally { clearTimeout(timeout) }
}

export const getFirstReadingOffer = () => call('get_first_reading_offer')
export const chooseFirstReading = id => call('choose_first_reading_offer', { p_submission_id: id })
export const dismissFirstReading = () => call('dismiss_first_reading_offer')
export const getAdminFirstReadingConfig = () => call('admin_get_first_reading_config')
export const saveAdminFirstReadingConfig = config => call('admin_save_first_reading_config', {
  p_submission_a: config.submissionA || null,
  p_submission_b: config.submissionB || null,
  p_enabled: config.enabled,
  p_expected_updated_at: config.updatedAt,
})

// Session-only protection if a dismiss could not be persisted. Account state is authoritative.
export const dismissedThisSession = new Set()
