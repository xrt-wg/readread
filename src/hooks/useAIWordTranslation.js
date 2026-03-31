import { useState, useRef, useCallback } from 'react'
import { translateText } from '../services/aiProviders/index'
import { aiConfigStore } from '../store/aiConfig'

export function useAIWordTranslation() {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const translate = useCallback(async (text, type, context) => {
    if (!text) return
    if ((type === 'word' || type === 'phrase') && !context) return

    const config = aiConfigStore.get()
    if (!aiConfigStore.isConfigured()) {
      setError('未配置 AI')
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setResult(null)
    setError(null)

    try {
      const out = await translateText(config, text, type, context, controller.signal)
      if (!controller.signal.aborted) {
        setResult(out)
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e.message ?? '翻译失败')
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
