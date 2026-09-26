/**
 * 翻译限流配置 — 服务层
 *
 * 阈值存于 translate_rate_limit_config 单行表，经 admin RPC 读写（乐观并发 + 审计），
 * translate.js 每次调用 consume_translate_quota 时读 DB，改配置即时生效、无需重部署函数。
 */

import { getSupabaseClient } from './client'

/** 管理端读取翻译限流配置：{ llmPerUserLimit, llmWindowHours, directPerIpLimit, directWindowHours, updatedAt }。 */
export async function getTranslateRateLimitConfig() {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('admin_get_translate_rate_limit_config')
  if (error) throw error
  return data
}

/** 管理端保存翻译限流配置（乐观并发）。 */
export async function saveTranslateRateLimitConfig(patch) {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('admin_save_translate_rate_limit_config', {
    p_llm_per_user_limit: patch.llmPerUserLimit,
    p_llm_window_hours: patch.llmWindowHours,
    p_direct_per_ip_limit: patch.directPerIpLimit,
    p_direct_window_hours: patch.directWindowHours,
    p_expected_updated_at: patch.expectedUpdatedAt,
  })
  if (error) throw error
  return data
}
