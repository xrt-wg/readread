import { translateBundle as myMemoryBundle } from './myMemory'

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
 * 统一直译入口
 * @param {string} word
 * @param {string} contextSentence
 * @param {'myMemory'|'deepl'|'youdao'} provider
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ meaning: string, contextTranslation: string }>}
 */
export async function translateDirect(word, contextSentence, provider, signal) {
  const startedAt = Date.now()
  try {
    let result
    if (provider === 'myMemory') {
      result = await myMemoryBundle(word, contextSentence, signal)
    } else if (provider === 'deepl' || provider === 'youdao') {
      result = await netlifyDirectBundle(word, contextSentence, provider, signal)
    } else {
      throw new Error(`Unknown direct provider: ${provider}`)
    }
    console.info('[DIRECT_PERF_CLIENT]', {
      provider,
      totalMs: Date.now() - startedAt,
      ok: true,
    })
    return result
  } catch (e) {
    if (!signal?.aborted) {
      console.info('[DIRECT_PERF_CLIENT]', {
        provider,
        totalMs: Date.now() - startedAt,
        ok: false,
        error: e.message,
      })
    }
    throw e
  }
}
