import { translateOne, translateBundle as myMemoryBundle } from './myMemory'
import { directConfig } from '../../../config/translation'

/**
 * 通过 Netlify Function 调用需要 Key 的直译服务（DeepL / 有道）
 */
async function netlifyDirectBundle(word, contextSentence, provider, signal) {
  const startedAt = Date.now()
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const res = await fetch('/.netlify/functions/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, word, contextSentence, requestId }),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error ?? `服务暂时不可用 (${res.status})`)
  }
  const data = await res.json()
  console.info('[DIRECT_PERF_CLIENT]', {
    requestId,
    provider,
    totalMs: Date.now() - startedAt,
    ok: true,
  })
  if (data.perf) {
    console.info('[DIRECT_PERF_FUNCTION]', {
      requestId: data.perf.requestId || requestId,
      provider: data.perf.provider,
      providerMs: data.perf.providerMs,
      functionTotalMs: data.perf.functionTotalMs,
    })
  }
  return data.result ?? { meaning: '', contextTranslation: '' }
}

/**
 * 通过 Netlify Function 调用 DeepL / 有道，返回 { text, provider }
 */
async function netlifyDirectText(text, provider, signal) {
  const startedAt = Date.now()
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const res = await fetch('/.netlify/functions/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, word: text, requestId }),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error ?? `服务暂时不可用 (${res.status})`)
  }
  const data = await res.json()
  console.info('[DIRECT_PERF_CLIENT]', {
    requestId,
    provider,
    totalMs: Date.now() - startedAt,
    ok: true,
  })
  if (data.perf) {
    console.info('[DIRECT_PERF_FUNCTION]', {
      requestId: data.perf.requestId || requestId,
      provider: data.perf.provider,
      providerMs: data.perf.providerMs,
      functionTotalMs: data.perf.functionTotalMs,
    })
  }
  const result = data.result
  const textOut = typeof result === 'string' ? result : (result?.meaning ?? '')
  return { text: textOut, provider }
}

/* ── 会话内缓存：同词秒出，避免重复请求（LRU，仅存活于页面会话） ── */
const DIRECT_CACHE_LIMIT = 200
const directCache = new Map()

function normalizeCacheKey(text) {
  return String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function readDirectCache(key) {
  const hit = directCache.get(key)
  if (hit) {
    // 刷新 LRU 位置
    directCache.delete(key)
    directCache.set(key, hit)
  }
  return hit
}

function writeDirectCache(key, value) {
  if (!key || !value?.text) return
  if (directCache.size >= DIRECT_CACHE_LIMIT) {
    directCache.delete(directCache.keys().next().value)
  }
  directCache.set(key, { text: value.text, provider: value.provider })
}

/**
 * 统一直译入口（弹窗使用）
 * provider 从 config/translation.js 的 directConfig.activeProvider 读取
 * @param {string} text
 * @param {AbortSignal} [signal]
 * @returns {Promise<{text: string, provider: string}>}
 */
async function translateDirectByProvider(text, provider, signal) {
  const startedAt = Date.now()
  try {
    let result
    if (provider === 'myMemory') {
      result = await translateOne(text, signal)
    } else if (provider === 'deepl' || provider === 'youdao') {
      result = await netlifyDirectText(text, provider, signal)
    } else {
      throw new Error(`Unknown direct provider: ${provider}`)
    }
    // myMemory returns plain string, others return {text, provider}
    const normalized = typeof result === 'string' ? { text: result, provider } : result
    // 空结果视为失败，触发上层 fallback（避免 200 空响应被当成功）
    if (!normalized?.text?.trim()) {
      console.info('[DIRECT_PERF_CLIENT]', { provider, totalMs: Date.now() - startedAt, ok: false, error: 'empty result' })
      throw new Error(`${provider} 返回空结果`)
    }
    console.info('[DIRECT_PERF_CLIENT]', { provider, totalMs: Date.now() - startedAt, ok: true })
    return normalized
  } catch (e) {
    if (!signal?.aborted) {
      console.info('[DIRECT_PERF_CLIENT]', { provider, totalMs: Date.now() - startedAt, ok: false, error: e.message })
    }
    throw e
  }
}

export async function translateDirect(text, signal) {
  return translateDirectByProvider(text, directConfig.activeProvider, signal)
}

export async function translateDirectWithFallback(text, signal) {
  const cacheKey = normalizeCacheKey(text)
  const cached = readDirectCache(cacheKey)
  if (cached) {
    console.info('[DIRECT_CACHE_HIT]', { provider: cached.provider })
    return { ...cached }
  }
  try {
    const out = await translateDirectByProvider(text, directConfig.activeProvider, signal)
    writeDirectCache(cacheKey, out)
    return out
  } catch (e) {
    if (signal?.aborted) throw e
    const fallback = directConfig.fallbackProvider
    if (!fallback) throw e
    console.info('[DIRECT_FALLBACK]', { from: directConfig.activeProvider, to: fallback })
    const out = await translateDirectByProvider(text, fallback, signal)
    writeDirectCache(cacheKey, out)
    return out
  }
}
