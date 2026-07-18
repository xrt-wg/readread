/**
 * AI API Provider 共享适配层
 *
 * 被 translate.js 和 generate-recommendation.js 共同引用。
 * 每个适配函数接受 apiKey 参数（由调用方注入），不直接读取 process.env。
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1'
const KIMI_BASE = 'https://api.moonshot.cn/v1'
const ZHIPU_BASE = 'https://open.bigmodel.cn/api/paas/v4'
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

// 上游 API 主动超时：必须小于 Netlify 函数 10s 硬超时，保证失败时有机会降级
const UPSTREAM_TIMEOUT_MS = 8000

// 上游返回 200 但内容为空时视为失败（触发调用方降级），并留下 finish_reason/usage 供复盘
function throwIfEmpty(text, provider, finishReason, usage) {
  if (text) return
  console.warn(
    JSON.stringify({
      tag: 'translate_empty_result',
      provider,
      finishReason: finishReason ?? 'unknown',
      usage: usage ?? null,
    })
  )
  throw new Error(`${provider} 返回空结果 (finish_reason: ${finishReason ?? 'unknown'})`)
}

async function callGemini(prompt, maxTokens, model, apiKey) {
  if (!apiKey) throw new Error('Gemini API key not configured')

  const res = await fetch(
    `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `Gemini error ${res.status}`)
  }
  const data = await res.json()
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const text = parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim()
  throwIfEmpty(text, 'gemini', data.candidates?.[0]?.finishReason, data.usageMetadata)
  return text
}

async function callDeepSeek(prompt, maxTokens, model, apiKey) {
  if (!apiKey) throw new Error('DeepSeek API key not configured')

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
      // 翻译为简单任务，关闭思考模式：避免思考 token 耗尽 max_tokens 导致
      // 200 空响应（finish_reason: length），同时显著降低延迟
      thinking: { type: 'disabled' },
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `DeepSeek error ${res.status}`)
  }
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content?.trim() ?? ''
  throwIfEmpty(text, 'deepseek', data.choices?.[0]?.finish_reason, data.usage)
  return text
}

async function callKimi(prompt, maxTokens, model, apiKey) {
  if (!apiKey) throw new Error('Kimi API key not configured')

  const res = await fetch(`${KIMI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `Kimi error ${res.status}`)
  }
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content?.trim() ?? ''
  throwIfEmpty(text, 'kimi', data.choices?.[0]?.finish_reason, data.usage)
  return text
}

async function callZhipu(prompt, maxTokens, model, apiKey) {
  if (!apiKey) throw new Error('Zhipu API key not configured')

  const res = await fetch(`${ZHIPU_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `Zhipu error ${res.status}`)
  }
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content?.trim() ?? ''
  throwIfEmpty(text, 'zhipu', data.choices?.[0]?.finish_reason, data.usage)
  return text
}

/**
 * 根据 provider preset key 获取对应的 API key。
 * 优先读取推荐专用环境变量 → 回退翻译通用环境变量 → 回退 generic 环境变量。
 *
 * @param {string} provider - preset key（如 "deepseek-recommendation-preset"）
 * @returns {string} API key
 */
function resolveApiKey(provider) {
  // 推荐专用 key 映射
  const recommendationKeyMap = {
    'gemini-recommendation-preset': 'PRESET_RECOMMENDATION_GEMINI_API_KEY',
    'deepseek-recommendation-preset': 'PRESET_RECOMMENDATION_DEEPSEEK_API_KEY',
  }
  // 翻译通用 key 映射（fallback）
  const translationKeyMap = {
    'gemini-recommendation-preset': 'PRESET_GEMINI_API_KEY',
    'gemini-preset': 'PRESET_GEMINI_API_KEY',
    'deepseek-recommendation-preset': 'PRESET_DEEPSEEK_API_KEY',
    'deepseek-preset': 'PRESET_DEEPSEEK_API_KEY',
    'kimi-preset': 'PRESET_KIMI_API_KEY',
    'zhipu-preset': 'PRESET_ZHIPU_API_KEY',
  }

  // 1. 尝试推荐专用 key
  const recKey = recommendationKeyMap[provider]
  if (recKey && process.env[recKey]) return process.env[recKey]

  // 2. 回退翻译通用 key
  const transKey = translationKeyMap[provider]
  if (transKey && process.env[transKey]) return process.env[transKey]

  // 3. 如果 provider 本身带有 "preset" 后缀，尝试 generic 查找
  throw new Error(`No API key found for provider: ${provider}`)
}

module.exports = {
  resolvePresetModel,
  resolveApiKey,
  callGemini,
  callDeepSeek,
  callKimi,
  callZhipu,
}
