/**
 * 付费开通请求 — 服务层
 *
 * 验证期闭环：用户「扫码支付 → 我已支付」提交申请；管理员后台「确认发放 / 拒绝」。
 * 发放动作落于服务端 security definer RPC（admin_confirm_payment 内累加 Pro 时长）。
 */

import { getSupabaseClient } from './client'

const PRICE_TEXT = '¥9.9'
const PAID_DAYS = 30

function mapRequest(row) {
  if (!row) return null
  return {
    id:             row.id,
    userId:         row.userId ?? null,
    email:          row.email ?? null,
    amountCents:    row.amountCents ?? null,
    requestedDays:  row.requestedDays ?? null,
    status:         row.status,
    createdAt:      row.createdAt ?? null,
    grantedAt:      row.grantedAt ?? null,
    rejectedReason: row.rejectedReason ?? null,
  }
}

/** 用户侧：提交「我已支付」申请（幂等，已存在 pending 则复用）。 */
export async function submitPaymentRequest() {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('submit_payment_request')
  if (error) throw error
  return mapRequest(data)
}

/** 用户侧：查询自己最近一笔申请（无则 null）。 */
export async function getMyPaymentRequest() {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('get_my_payment_request')
  if (error) throw error
  return mapRequest(data)
}

/** 管理员侧：付费申请队列（含已处理历史）。 */
export async function listPaymentRequests() {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('admin_list_payment_requests')
  if (error) throw error
  return (data || []).map(mapRequest)
}

/** 管理员侧：确认发放（默认按申请天数 30，可 p_days 覆盖）。 */
export async function confirmPaymentRequest(requestId, days = null) {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('admin_confirm_payment', {
    p_request_id: requestId,
    p_days: days,
  })
  if (error) throw error
  return data
}

/** 管理员侧：拒绝申请。 */
export async function rejectPaymentRequest(requestId, reason = null) {
  const client = getSupabaseClient()
  const { error } = await client.rpc('admin_reject_payment', {
    p_request_id: requestId,
    p_reason: reason,
  })
  if (error) throw error
}

/** 读取收款码 data URL（未设置则 null）。 */
export async function getPaymentQr() {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('get_payment_qr')
  if (error) throw error
  return data || null
}

/** 管理员侧：设置/清除收款码（传 null 或空串清除）。 */
export async function setPaymentQr(dataUrl) {
  const client = getSupabaseClient()
  const { error } = await client.rpc('admin_set_payment_qr', { p_qr_data_url: dataUrl })
  if (error) throw error
}

export { PRICE_TEXT, PAID_DAYS }
