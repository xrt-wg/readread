const DEEPL_BASE = 'https://api-free.deepl.com/v2'
const YOUDAO_BASE = 'https://openapi.youdao.com/api'
const crypto = require('crypto')
const { verifyJwt } = require('../lib/auth.cjs')
const {
  resolvePresetModel,
  resolveApiKey,
  callGemini,
  callDeepSeek,
  callKimi,
  callZhipu,
} = require('../lib/aiProviders.cjs')

// 上游 API 主动超时：必须小于 Netlify 函数 10s 硬超时，保证失败时有机会降级
const UPSTREAM_TIMEOUT_MS = 8000

async function callDeepL(word, contextSentence) {
  const apiKey = process.env.PRESET_DEEPL_API_KEY
  if (!apiKey) throw new Error('DeepL key not configured on server')

  const texts = contextSentence ? [word, contextSentence] : [word]
  const res = await fetch(`${DEEPL_BASE}/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `DeepL-Auth-Key ${apiKey}`,
    },
    body: JSON.stringify({ text: texts, target_lang: 'ZH', source_lang: 'EN' }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message ?? `DeepL error ${res.status}`)
  }
  const data = await res.json()
  const translations = data.translations ?? []
  const meaning = translations[0]?.text?.trim() ?? ''
  if (!meaning) throw new Error('DeepL 返回空结果')
  return {
    meaning,
    contextTranslation: translations[1]?.text?.trim() ?? '',
  }
}

function truncateForYoudao(text) {
  const str = String(text ?? '')
  if (str.length <= 20) return str
  return `${str.slice(0, 10)}${str.length}${str.slice(-10)}`
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex')
}

function mapYoudaoError(code) {
  const table = {
    '101': '缺少必填参数',
    '102': '不支持的语言类型',
    '103': '翻译文本过长',
    '104': '不支持的 API 类型',
    '105': '不支持的签名类型',
    '106': '不支持的响应类型',
    '107': '不支持的传输加密类型',
    '108': '应用 ID 无效',
    '109': '批量翻译文本格式错误',
    '110': '无相关服务的有效实例',
    '111': '开发者账号无效',
    '112': '请求服务无效',
    '113': 'IP 地址不在可访问范围',
    '114': '当前访问超过服务并发限制',
    '201': '解密失败，检查传输加密设置',
    '202': '签名检验失败，检查 appKey/appSecret',
    '203': '访问 IP 未授权',
    '205': '请求时间戳无效',
    '206': '请求参数不合法',
    '207': '文本为空',
    '301': '辞典查询失败',
    '302': '翻译查询失败',
    '303': '服务端其他异常',
    '401': '账户欠费或余额不足',
    '411': '访问频率受限',
  }
  return table[String(code)] || '未知错误'
}

async function callYoudaoOne(text, appKey, appSecret) {
  if (!text?.trim()) return ''

  const q = text.trim()
  const salt = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`
  const curtime = `${Math.floor(Date.now() / 1000)}`
  const sign = sha256(appKey + truncateForYoudao(q) + salt + curtime + appSecret)

  const payload = new URLSearchParams({
    q,
    from: 'en',
    to: 'zh-CHS',
    appKey,
    salt,
    sign,
    signType: 'v3',
    curtime,
  })

  const res = await fetch(YOUDAO_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })

  if (!res.ok) {
    throw new Error(`有道请求失败 (${res.status})`)
  }

  const data = await res.json().catch(() => ({}))
  if (data.errorCode !== '0') {
    const code = data.errorCode ?? 'unknown'
    throw new Error(`有道翻译失败(${code}): ${mapYoudaoError(code)}`)
  }

  const translated = Array.isArray(data.translation) ? data.translation[0] : ''
  return String(translated ?? '').trim()
}

async function callYoudao(word, contextSentence) {
  const appKey = process.env.PRESET_YOUDAO_APP_KEY
  const appSecret = process.env.PRESET_YOUDAO_APP_SECRET
  if (!appKey || !appSecret) {
    throw new Error('有道翻译未配置：请在 Netlify 配置 PRESET_YOUDAO_APP_KEY 和 PRESET_YOUDAO_APP_SECRET')
  }

  const [meaning, contextTranslation] = await Promise.all([
    callYoudaoOne(word, appKey, appSecret),
    contextSentence ? callYoudaoOne(contextSentence, appKey, appSecret) : Promise.resolve(''),
  ])

  // 词义为空视为失败（触发降级）；语境句译文允许为空
  if (!meaning) throw new Error('有道返回空结果')
  return { meaning, contextTranslation }
}

// ─── 鉴权 + 限流（S2）──────────────────────────────────────────────────────────
// 计数与阈值落在 Supabase：translate_rate_limits 表 + translate_rate_limit_config 单行配置。
// 函数以 service_role 直连 consume_translate_quota（原子固定窗口递增）；LLM 路径 fail-closed，直译路径 fail-open。

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

function clientIp(event) {
  const headers = event.headers || {}
  return String(
    headers['client-ip'] ||
    headers['x-forwarded-for'] ||
    headers['x-nf-client-connection-ip'] ||
    ''
  ).split(',')[0].trim() || 'unknown'
}

function jsonError(statusCode, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  }
}

exports.handler = async function (event) {
  const fnStart = Date.now()
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    }
  }

  const { prompt, maxTokens = 100, provider, requestId, word, contextSentence } = body

  const isDirect = provider === 'deepl' || provider === 'youdao'

  if (!isDirect && !prompt) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing prompt' }),
    }
  }

  if (isDirect && !word) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing word for direct translation' }),
    }
  }

  // 直译：仅 IP 级限流，fail-open（计数不可用仍放行，保「划词永远在线」）
  // LLM：JWT 鉴权 + 每用户限流，fail-closed（计数不可用拒绝，防烧钱）
  if (isDirect) {
    try {
      const rl = await consumeRateLimit('ip', clientIp(event), 'direct')
      if (rl && rl.allowed === false) {
        return jsonError(429, '翻译请求过于频繁，请稍后再试')
      }
    } catch (rateError) {
      console.error(JSON.stringify({ tag: 'translate_ratelimit_direct_error', requestId: requestId || null, message: rateError.message }))
      // fail-open：限流后端不可用仍放行
    }
  } else {
    const tokenPayload = await verifyJwt(event)
    if (!tokenPayload) {
      return jsonError(401, '未登录或登录已过期，请重新登录')
    }
    try {
      const rl = await consumeRateLimit('user', tokenPayload.sub, 'llm')
      if (rl && rl.allowed === false) {
        return jsonError(429, '翻译请求过于频繁，请稍后再试')
      }
    } catch (rateError) {
      console.error(JSON.stringify({ tag: 'translate_ratelimit_llm_error', requestId: requestId || null, message: rateError.message }))
      return jsonError(503, '翻译服务暂时不可用，请稍后重试')
    }
  }

  try {
    const providerStart = Date.now()
    let result
    let resolvedModel = ''

    if (isDirect) {
      if (provider === 'deepl') {
        result = await callDeepL(word, contextSentence)
      } else if (provider === 'youdao') {
        result = await callYoudao(word, contextSentence)
      }
      const providerMs = Date.now() - providerStart
      const functionTotalMs = Date.now() - fnStart
      console.log(JSON.stringify({ tag: 'direct_perf', requestId: requestId || null, provider, providerMs, functionTotalMs }))
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result, perf: { requestId: requestId || null, provider, providerMs, functionTotalMs } }),
      }
    }

    if (provider === 'gemini-preset') {
      resolvedModel = resolvePresetModel(provider)
      result = await callGemini(prompt, maxTokens, resolvedModel, resolveApiKey(provider))
    } else if (provider === 'deepseek-preset') {
      resolvedModel = resolvePresetModel(provider)
      result = await callDeepSeek(prompt, maxTokens, resolvedModel, resolveApiKey(provider))
    }  else if (provider === 'kimi-preset') {
      resolvedModel = resolvePresetModel(provider)
      result = await callKimi(prompt, maxTokens, resolvedModel, resolveApiKey(provider))
    } else if (provider === 'zhipu-preset') {
      resolvedModel = resolvePresetModel(provider)
      result = await callZhipu(prompt, maxTokens, resolvedModel, resolveApiKey(provider))
    } else {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Unknown preset provider: ${provider}` }),
      }
    }
    const providerMs = Date.now() - providerStart
    const functionTotalMs = Date.now() - fnStart

    console.log(
      JSON.stringify({
        tag: 'translate_perf',
        requestId: requestId || null,
        provider,
        model: resolvedModel,
        providerMs,
        functionTotalMs,
      })
    )

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        result,
        perf: {
          requestId: requestId || null,
          provider,
          model: resolvedModel,
          providerMs,
          functionTotalMs,
        },
      }),
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        tag: 'translate_perf_error',
        requestId: requestId || null,
        provider,
        message: e.message,
        functionTotalMs: Date.now() - fnStart,
      })
    )
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
    }
  }
}
