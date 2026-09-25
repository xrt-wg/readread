/**
 * 意见反馈 — 服务层
 *
 * 验证期闭环：账号面板「意见反馈」容器展示管理员上传的微信二维码；
 * 管理员在后台「意见反馈」页上传/替换/清除。文案中的「会员时长奖励」本轮仅为引导话术，不落地发放逻辑。
 */

import { getSupabaseClient } from './client'

/** 读取反馈微信二维码 data URL（未设置则 null）。 */
export async function getFeedbackQr() {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('get_feedback_qr')
  if (error) throw error
  return data || null
}

/** 管理员侧：设置/清除反馈二维码（传 null 或空串清除）。 */
export async function setFeedbackQr(dataUrl) {
  const client = getSupabaseClient()
  const { error } = await client.rpc('admin_set_feedback_qr', { p_qr_data_url: dataUrl })
  if (error) throw error
}
