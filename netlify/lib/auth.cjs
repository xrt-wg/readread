/**
 * 共享鉴权 + 限流辅助（Netlify Functions 服务端，CommonJS）。
 *
 * - verifyJwt：校验 Supabase access_token（HS256），失败/缺失返回 null。
 * - consumeRateLimit：以 service_role 直连 consume_translate_quota 原子递增，
 *   返回 { allowed, used, limit, ... }；LLM 路径据此 fail-closed（不可用即拒绝）。
 *
 * 依赖环境变量：SUPABASE_JWT_SECRET / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY。
 * 与 translate.js 内的同源实现保持一致（translate.js 暂保留内联版，后续可统一到这里）。
 */

const jwt = require('jsonwebtoken')

function verifyJwt(event) {
  const auth = String(event.headers?.authorization || event.headers?.Authorization || '')
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return null
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) return null
  try {
    // 显式锁定 HS256，规避算法混淆；jsonwebtoken 默认校验 exp
    return jwt.verify(token, secret, { algorithms: ['HS256'] })
  } catch {
    return null
  }
}

let rateLimitClient = null
function getRateLimitClient() {
  if (!rateLimitClient) {
    const { createClient } = require('@supabase/supabase-js')
    rateLimitClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
  }
  return rateLimitClient
}

async function consumeRateLimit(scope, scopeId, kind) {
  const { data, error } = await getRateLimitClient().rpc('consume_translate_quota', {
    p_scope: scope,
    p_scope_id: scopeId,
    p_kind: kind,
  })
  if (error) throw error
  return data
}

module.exports = { verifyJwt, consumeRateLimit }
