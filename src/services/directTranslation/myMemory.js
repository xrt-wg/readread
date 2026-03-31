const ENDPOINT = 'https://api.mymemory.translated.net/get'

/**
 * 使用 MyMemory 翻译单段文本（EN → ZH）
 * @param {string} text
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>}
 */
export async function translateOne(text, signal) {
  if (!text?.trim()) return ''
  const url = `${ENDPOINT}?q=${encodeURIComponent(text.trim())}&langpair=en|zh`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`MyMemory 请求失败 (${res.status})`)
  const data = await res.json()
  if (data.responseStatus !== 200) throw new Error(data.responseDetails ?? 'MyMemory 翻译失败')
  return data.responseData?.translatedText ?? ''
}

/**
 * 并行翻译词/短句 和 语境句，各自独立
 * @param {string} word
 * @param {string} contextSentence
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ meaning: string, contextTranslation: string }>}
 */
export async function translateBundle(word, contextSentence, signal) {
  const [meaning, contextTranslation] = await Promise.all([
    translateOne(word, signal),
    contextSentence ? translateOne(contextSentence, signal) : Promise.resolve(''),
  ])
  return { meaning, contextTranslation }
}
