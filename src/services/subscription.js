/**
 * 订阅状态服务模块
 *
 * getSubscriptionStatus — 读取 Free/Pro 身份与两个额度杠杆的当前状态。
 * 权威在服务端 SECURITY DEFINER RPC（get_subscription_status），前端只读消费。
 */

import { getSupabaseClient } from './supabase'

const FALLBACK_STATUS = {
  plan: 'free',
  proExpiresAt: null,
  importUsed: 0,
  importLimit: null,
  bookmarkUsed: 0,
  bookmarkLimit: null,
  bookmarkWeekStart: null,
}

/**
 * 读取当前用户订阅状态。
 * @returns {Promise<{
 *   plan: 'free'|'pro',
 *   proExpiresAt: string|null,
 *   importUsed: number,
 *   importLimit: number|null,
 *   bookmarkUsed: number,
 *   bookmarkLimit: number|null,
 *   bookmarkWeekStart: string|null,
 * }>}
 */
export async function getSubscriptionStatus() {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('get_subscription_status')
  if (error) throw error
  return data ?? FALLBACK_STATUS
}
