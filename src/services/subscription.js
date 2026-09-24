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

function mapAdminSubscriptionRow(row) {
  return {
    userId: row.userId ?? null,
    plan: row.plan ?? 'free',
    proExpiresAt: row.proExpiresAt ?? null,
    importRemaining: row.importRemaining ?? null,
    bookmarkRemaining: row.bookmarkRemaining ?? null,
  }
}

/**
 * 管理员侧：一次性读取所有用户的订阅身份与额度余量。
 * 与 get_subscription_status 同口径（服务端派生、Pro 不显 Free 额度）。
 * 后台「用户基础信息」页按 userId 与 profiles 列表 merge 消费。
 * @returns {Promise<Array<{userId, plan, proExpiresAt, importRemaining, bookmarkRemaining}>>}
 */
export async function listAdminSubscriptions() {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('admin_list_user_subscriptions')
  if (error) throw error
  return (data || []).map(mapAdminSubscriptionRow)
}
