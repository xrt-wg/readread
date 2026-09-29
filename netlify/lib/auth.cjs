/**
 * 共享鉴权 + 限流辅助（Netlify Functions 服务端，CommonJS）。
 *
 * - verifyJwt：校验 Supabase access_token。项目签发 ES256（非对称）令牌，
 *   经 Supabase JWKS（/.well-known/jwks.json）取公钥验签；兼容 HS256
 *   （自定义 JWT secret）作兜底。失败/缺失返回 null。
 * - consumeRateLimit：以 service_role 直连 consume_translate_quota 原子递增，
 *   返回 { allowed, used, limit, ... }；LLM 路径据此 fail-closed（不可用即拒绝）。
 *
 * 依赖环境变量：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /（HS256 兜底时）SUPABASE_JWT_SECRET。
 */

const crypto = require('crypto')
const jwt = require('jsonwebtoken')

// ─── JWT 校验 ────────────────────────────────────────────────────────────────

function projectRefFromUrl(url) {
  try {
    return new URL(url).hostname.split('.')[0]
  } catch {
    return null
  }
}

function jwkToPem(jwk) {
  const { kty, crv, x, y } = jwk
  return crypto.createPublicKey({ key: { kty, crv, x, y }, format: 'jwk' }).export({ type: 'spki', format: 'pem' })
}

function decodeHeader(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

// JWKS 公钥缓存：键位轮换不频繁，10 分钟 TTL；kid 未命中时强制重取。
let jwksCache = { keys: [], fetchedAt: 0 }
const JWKS_TTL_MS = 10 * 60 * 1000

async function fetchJwks(ref) {
  const res = await fetch(`https://${ref}.supabase.co/auth/v1/.well-known/jwks.json`)
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`)
  const jwks = await res.json()
  return jwks.keys || []
}

async function getJwksKeys(force = false) {
  const ref = projectRefFromUrl(process.env.SUPABASE_URL)
  if (!ref) throw new Error('SUPABASE_URL not configured')
  const now = Date.now()
  if (!force && jwksCache.keys.length && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys
  }
  const keys = await fetchJwks(ref)
  jwksCache = { keys, fetchedAt: now }
  return keys
}

async function verifyJwt(event) {
  const auth = String(event.headers?.authorization || event.headers?.Authorization || '')
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return null

  const header = decodeHeader(token)
  if (!header) return null

  const ref = projectRefFromUrl(process.env.SUPABASE_URL)
  const issuer = ref ? `https://${ref}.supabase.co/auth/v1` : undefined

  try {
    // ES256：Supabase 默认非对称签名，走 JWKS 取公钥验签
    if (header.alg === 'ES256') {
      let keys = await getJwksKeys()
      let jwk = keys.find((k) => k.kid === header.kid && k.kty === 'EC')
      if (!jwk) {
        keys = await getJwksKeys(true) // 键已轮换，强制重取一次
        jwk = keys.find((k) => k.kid === header.kid && k.kty === 'EC')
      }
      if (!jwk) return null
      return jwt.verify(token, jwkToPem(jwk), {
        algorithms: ['ES256'],
        issuer,
        audience: 'authenticated',
      })
    }

    // HS256：自定义 JWT secret 的遗留场景，作兜底
    if (header.alg === 'HS256') {
      const secret = process.env.SUPABASE_JWT_SECRET
      if (!secret) return null
      return jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer,
        audience: 'authenticated',
      })
    }

    return null
  } catch {
    return null
  }
}

// ─── 限流 ────────────────────────────────────────────────────────────────────

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
