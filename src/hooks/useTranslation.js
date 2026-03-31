import { useState, useCallback, useRef } from 'react'

const cache = new Map()

export function useTranslation() {
  const [state, setState] = useState({ result: null, loading: false, error: null })
  const abortRef = useRef(null)

  const translate = useCallback(async (text) => {
    const trimmed = text.trim()
    if (!trimmed) return

    if (cache.has(trimmed)) {
      setState({ result: cache.get(trimmed), loading: false, error: null })
      return
    }

    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState({ result: null, loading: true, error: null })

    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=en|zh-CN`
      const res = await fetch(url, { signal: controller.signal })
      const data = await res.json()

      if (data.responseStatus === 200) {
        const translation = data.responseData.translatedText
        cache.set(trimmed, translation)
        setState({ result: translation, loading: false, error: null })
      } else {
        setState({ result: null, loading: false, error: '翻译失败，请稍后重试' })
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setState({ result: null, loading: false, error: '网络错误，请检查连接' })
      }
    }
  }, [])

  const clear = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    setState({ result: null, loading: false, error: null })
  }, [])

  return { ...state, translate, clear }
}
