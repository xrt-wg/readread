const { verifyJwt } = require('../lib/auth.cjs')
const dns = require('dns').promises

// 私网/保留地址拦截：阻断 SSRF（回环、链路本地、私网、CGNAT、组播/保留）
function isPrivateIp(ip) {
  if (ip.includes(':')) {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7 ULA
    if (/^fe[89ab]/.test(lower)) return true // fe80::/10 link-local
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateIp(mapped[1])
    return false
  }
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // link-local / 云元数据端点
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a >= 224) return true // 组播/保留
  return false
}

function json(statusCode, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  }
}

exports.handler = async (event) => {
  // 鉴权：URL 导入已在登录后触发，未登录/过期直接 401
  const payload = await verifyJwt(event)
  if (!payload) return json(401, '未登录或登录已过期，请重新登录')

  const url = event.queryStringParameters?.url
  if (!url) return json(400, 'missing url parameter')

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return json(400, 'invalid url')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return json(400, 'only http/https urls are allowed')
  }

  // SSRF 拦截：解析目标主机，拒绝指向私网/回环/链路本地地址的请求
  try {
    const addresses = await dns.lookup(parsed.hostname, { all: true })
    if (!addresses?.length) return json(502, 'cannot resolve host')
    if (addresses.some((a) => isPrivateIp(a.address))) {
      return json(403, 'private or internal addresses are not allowed')
    }
  } catch (e) {
    return json(502, `dns resolve failed: ${e.message}`)
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': parsed.origin,
      },
      signal: AbortSignal.timeout(20000),
    })

    if (!res.ok) return json(502, `upstream ${res.status}`)

    const html = await res.text()
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html }),
    }
  } catch (e) {
    return json(502, e.message)
  }
}
