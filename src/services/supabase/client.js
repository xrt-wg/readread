import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

function getMissingConfigKeys() {
  const missingKeys = []

  if (!supabaseUrl) {
    missingKeys.push('VITE_SUPABASE_URL')
  }

  if (!supabaseAnonKey) {
    missingKeys.push('VITE_SUPABASE_ANON_KEY')
  }

  return missingKeys
}

export function isSupabaseConfigured() {
  return getMissingConfigKeys().length === 0
}

export function assertSupabaseConfigured() {
  const missingKeys = getMissingConfigKeys()

  if (missingKeys.length > 0) {
    throw new Error(`缺少 Supabase 配置：${missingKeys.join(', ')}`)
  }
}

let supabaseClient = null

export function getSupabaseClient() {
  assertSupabaseConfigured()

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  }

  return supabaseClient
}
