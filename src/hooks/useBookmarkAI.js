import { useCallback } from 'react'
import { translateText, getBookmarkAIConfig } from '../services/aiProviders/index'
import { bookmarkStore } from '../store/storage'

export function useBookmarkAI() {
  const translateBookmark = useCallback(async (bookmark, onComplete) => {
    const config = getBookmarkAIConfig()
    const isShort = bookmark.type === 'word' || bookmark.type === 'phrase'
    try {
      let translation = null
      let contextTranslation = null

      if (isShort) {
        const out = await translateText(
          config,
          bookmark.text,
          'word_phrase_bundle',
          bookmark.contextSentence
        )
        translation = out?.meaning ?? ''
        contextTranslation = out?.contextTranslation ?? null
      } else {
        translation = await translateText(
          config,
          bookmark.text,
          bookmark.type,
          null
        )
      }

      const updated = {
        ...bookmark,
        translation,
        contextTranslation,
        translationStatus: 'done',
      }
      bookmarkStore.save(updated)
      onComplete?.(updated)
    } catch {
      const updated = { ...bookmark, translationStatus: 'error' }
      bookmarkStore.save(updated)
      onComplete?.(updated)
    }
  }, [])

  return { translateBookmark }
}
