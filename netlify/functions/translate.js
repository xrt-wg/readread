const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1'
const DEEPL_BASE = 'https://api-free.deepl.com/v2'
const YOUDAO_BASE = 'https://openapi.youdao.com/api'
const crypto = require('crypto')
const presetModels = require('../../config/presetModels.json')

function resolvePresetModel(provider) {
  const config = presetModels[provider]
  if (!config) throw new Error(`Unknown preset provider: ${provider}`)
  const model = config.defaultModel
  if (!model) {
    throw new Error(`Missing defaultModel for ${provider}`)
  }
  return model
}

async function callGemini(prompt, maxTokens, model) {
  const apiKey = process.env.PRESET_GEMINI_API_KEY
  if (!apiKey) throw new Error('Gemini preset key not configured on server')

  const res = await fetch(
    `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
      }),
    }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `Gemini error ${res.status}`)
  }
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
}

async function callDeepSeek(prompt, maxTokens, model) {
  const apiKey = process.env.PRESET_DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DeepSeek preset key not configured on server')

  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `DeepSeek error ${res.status}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

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
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message ?? `DeepL error ${res.status}`)
  }
  const data = await res.json()
  const translations = data.translations ?? []
  return {
    meaning: translations[0]?.text?.trim() ?? '',
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

  return { meaning, contextTranslation }
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
      result = await callGemini(prompt, maxTokens, resolvedModel)
    } else if (provider === 'deepseek-preset') {
      resolvedModel = resolvePresetModel(provider)
      result = await callDeepSeek(prompt, maxTokens, resolvedModel)
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
