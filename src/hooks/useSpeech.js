import { useCallback, useRef, useState, useEffect } from 'react'

/**
 * useSpeech — 文本朗读 hook
 * 当前实现：Web Speech API（原生，无需后端）
 * 替换方式：只需修改 speak 内部实现，调用方无感知
 */
export function useSpeech() {
  const utteranceRef = useRef(null)
  const [error, setError] = useState(null)
  const failCountRef = useRef(0)

  const clearError = useCallback(() => {
    setError(null)
    failCountRef.current = 0
  }, [])

  const speak = useCallback((text, lang = 'en-US') => {
    if (!window.speechSynthesis) {
      setError('浏览器不支持语音朗读，请尝试 Chrome 或 Edge 浏览器')
      return
    }

    // 检查是否有可用的语音包
    const voices = window.speechSynthesis.getVoices()
    const hasVoice = voices.some(v => v.lang.startsWith(lang.split('-')[0]))

    if (!hasVoice) {
      setError('系统未找到语音包，请检查系统语言设置')
      return
    }

    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    utterance.rate = 0.9
    utterance.pitch = 1

    // 检测发音是否成功开始
    let hasStarted = false
    const startTimeout = setTimeout(() => {
      if (!hasStarted) {
        failCountRef.current += 1
        if (failCountRef.current >= 2) {
          setError('语音朗读未能正常工作，请尝试刷新页面或使用 Edge 浏览器')
        }
      }
    }, 500)

    utterance.onstart = () => {
      hasStarted = true
      clearTimeout(startTimeout)
      failCountRef.current = 0
      setError(null)
    }

    utterance.onerror = (e) => {
      clearTimeout(startTimeout)
      failCountRef.current += 1
      if (failCountRef.current >= 2) {
        if (e.error === 'not-allowed') {
          setError('浏览器阻止了语音播放，请点击页面任意位置后再试')
        } else {
          setError('语音朗读失败，请尝试刷新页面或使用 Edge 浏览器')
        }
      }
    }

    utteranceRef.current = utterance
    window.speechSynthesis.speak(utterance)
  }, [])

  const stop = useCallback(() => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
  }, [])

  // 确保 voices 已加载（某些浏览器需要异步加载）
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return

    const loadVoices = () => {
      window.speechSynthesis.getVoices()
    }

    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices

    return () => {
      window.speechSynthesis.onvoiceschanged = null
    }
  }, [])

  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  return { speak, stop, isSupported, error, clearError }
}
