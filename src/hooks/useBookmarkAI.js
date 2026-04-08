import { useCallback } from 'react'
import { translateText, getBookmarkAIConfig, getFallbackAIConfig } from '../services/aiProviders/index'
import { translateDirectWithFallback } from '../services/directTranslation/index'
import { aiConfig } from '../../config/translation'
import { bookmarkStore } from '../store/storage'

async function runAI(config, bookmark, isShort) {
  if (isShort) {
    const out = await translateText(config, bookmark.text, 'word_phrase_bundle', bookmark.contextSentence)
    return { translation: out?.meaning ?? '', contextTranslation: out?.contextTranslation ?? null }
  }
  const translation = await translateText(config, bookmark.text, bookmark.type, null)
  return { translation, contextTranslation: null }
}

export function useBookmarkAI() {
  const translateBookmark = useCallback(async (bookmark, onComplete) => {
    const isShort = bookmark.type === 'word' || bookmark.type === 'phrase'
    let translation = null
    let contextTranslation = null
    let success = false

    // ① 主力 AI
    try {
      const out = await runAI(getBookmarkAIConfig(), bookmark, isShort)
      translation = out.translation
      contextTranslation = out.contextTranslation
      success = true
    } catch {
      console.info('[BOOKMARK_FALLBACK] 主力AI失败，尝试备用AI')
    }

    // ② 备用 AI
    if (!success) {
      const fallbackConfig = getFallbackAIConfig()
      if (fallbackConfig) {
        try {
          const out = await runAI(fallbackConfig, bookmark, isShort)
          translation = out.translation
          contextTranslation = out.contextTranslation
          success = true
        } catch {
          console.info('[BOOKMARK_FALLBACK] 备用AI失败，尝试直译')
        }
      }
    }

    // ③④ 直译兜底（含其自身的备用 provider）
    if (!success && aiConfig.fallbackToDirect) {
      try {
        translation = await translateDirectWithFallback(bookmark.text)
        contextTranslation = null
        success = true
      } catch {
        console.info('[BOOKMARK_FALLBACK] 直译兜底也失败')
      }
    }

    const updated = success
      ? { ...bookmark, translation, contextTranslation, translationStatus: 'done' }
      : { ...bookmark, translationStatus: 'error' }

    bookmarkStore.save(updated)
    onComplete?.(updated)
  }, [])

  return { translateBookmark }
}
