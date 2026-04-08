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
 * 通过 Netlify Function 调用 DeepL / 有道，返回文本字符串
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
  return typeof result === 'string' ? result : (result?.meaning ?? '')
}

/**
 * 统一直译入口（弹窗使用）
 * provider 从 config/translation.js 的 directConfig.activeProvider 读取
 * @param {string} text
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>}
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
    console.info('[DIRECT_PERF_CLIENT]', { provider, totalMs: Date.now() - startedAt, ok: true })
    return result
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
  try {
    return await translateDirectByProvider(text, directConfig.activeProvider, signal)
  } catch (e) {
    if (signal?.aborted) throw e
    const fallback = directConfig.fallbackProvider
    if (!fallback) throw e
    console.info('[DIRECT_FALLBACK]', { from: directConfig.activeProvider, to: fallback })
    return translateDirectByProvider(text, fallback, signal)
  }
}
