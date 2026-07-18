import { useState, useRef, useCallback } from 'react'
import { translateDirectWithFallback } from '../services/directTranslation/index'

export function useDirectTranslation() {
  const [result, setResult] = useState(null)
  const [provider, setProvider] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const translate = useCallback(async (text) => {
    if (!text?.trim()) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    // 8s 总超时：超时后中止请求并给出明确错误，不再无限转圈
    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 8000)
    setLoading(true)
    setResult(null)
    setProvider(null)
    setError(null)
    try {
      const out = await translateDirectWithFallback(text.trim(), controller.signal)
      if (!controller.signal.aborted) {
        setResult(out.text)
        setProvider(out.provider)
      }
    } catch (e) {
      if (timedOut) {
        setError('翻译超时，请重试')
      } else if (!controller.signal.aborted) {
        setError(e.message ?? '翻译失败')
      }
    } finally {
      clearTimeout(timeoutId)
      if (!controller.signal.aborted || timedOut) setLoading(false)
    }
  }, [])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    setResult(null)
    setProvider(null)
    setLoading(false)
    setError(null)
  }, [])

  return { result, provider, loading, error, translate, clear }
}
