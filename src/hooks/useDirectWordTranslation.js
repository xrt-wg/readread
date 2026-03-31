import { useState, useRef, useCallback } from 'react'
import { translateDirect } from '../services/directTranslation/index'
import { aiConfigStore } from '../store/aiConfig'

export function useDirectWordTranslation() {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const translate = useCallback(async (word, contextSentence) => {
    if (!word) return

    const config = aiConfigStore.get()
    const provider = config.directProvider ?? 'myMemory'

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setResult(null)
    setError(null)

    const startedAt = Date.now()
    try {
      const out = await translateDirect(word, contextSentence, provider, controller.signal)
      if (!controller.signal.aborted) {
        setResult(out)
        console.info('[DIRECT_PERF_CLIENT]', {
          provider,
          totalMs: Date.now() - startedAt,
          ok: true,
        })
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e.message ?? '翻译失败')
        console.info('[DIRECT_PERF_CLIENT]', {
          provider,
          totalMs: Date.now() - startedAt,
          ok: false,
          error: e.message,
        })
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }, [])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    setResult(null)
    setLoading(false)
    setError(null)
  }, [])

  return { result, loading, error, translate, clear }
}
