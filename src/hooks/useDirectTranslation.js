import { useState, useRef, useCallback } from 'react'
import { translateDirect } from '../services/directTranslation/index'

export function useDirectTranslation() {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const translate = useCallback(async (text) => {
    if (!text?.trim()) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const out = await translateDirect(text.trim(), controller.signal)
      if (!controller.signal.aborted) setResult(out)
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message ?? '翻译失败')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
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
