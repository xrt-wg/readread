/**
 * 检测选中文本类型
 * @returns {'word'|'phrase'|'sentence'|'paragraph'}
 */
export function detectSelectionType(text) {
  const trimmed = text.trim()
  const words = trimmed.split(/\s+/).filter(Boolean)
  const hasNewline = /\n/.test(trimmed)

  if (hasNewline || words.length > 30) return 'paragraph'
  if (words.length === 1) return 'word'
  if (words.length <= 6 && !/[.!?]$/.test(trimmed)) return 'phrase'
  return 'sentence'
}

/**
 * 在段落文本中找到包含 selectedText 的完整语法句
 * 以 .!? 作为句子边界
 */
export function findContainingSentence(paragraphText, selectedText) {
  if (!paragraphText || !selectedText) return paragraphText

  // 拆分为语法句：匹配到 .!? 后跟空格或字符串结束
  const raw = paragraphText
  const sentences = []
  // 正则：以 .!? 结尾（允许多个），之后是空格或字符串末尾
  const regex = /[^.!?]+(?:[.!?]+(?:\s|$))?/g
  let match
  while ((match = regex.exec(raw)) !== null) {
    const s = match[0].trim()
    if (s) sentences.push(s)
  }

  if (sentences.length === 0) return paragraphText

  const needle = selectedText.trim().toLowerCase()
  const found = sentences.find((s) => s.toLowerCase().includes(needle))
  return found?.trim() ?? paragraphText
}

/**
 * 获取选中文本在段落中的字符偏移量
 */
export function getCharOffset(paragraphText, selectedText) {
  const idx = paragraphText.indexOf(selectedText.trim())
  return idx >= 0 ? idx : 0
}

/**
 * 在 sentence 中定位 word，返回 { before, match, after }
 * 大小写不敏感匹配，match 保留原始大小写
 */
export function highlightWord(sentence, word) {
  if (!sentence || !word) return { before: sentence ?? '', match: '', after: '' }
  const idx = sentence.toLowerCase().indexOf(word.toLowerCase())
  if (idx === -1) return { before: sentence, match: '', after: '' }
  return {
    before: sentence.slice(0, idx),
    match: sentence.slice(idx, idx + word.length),
    after: sentence.slice(idx + word.length),
  }
}

/**
 * 根据 type 返回高亮样式配置
 */
export const HIGHLIGHT_STYLES = {
  word: {
    background: 'rgba(251, 191, 36, 0.35)',
    borderBottom: 'none',
    textDecoration: 'none',
  },
  phrase: {
    background: 'rgba(52, 211, 153, 0.28)',
    borderBottom: 'none',
    textDecoration: 'none',
  },
  sentence: {
    background: 'transparent',
    borderBottom: '2px solid rgba(99, 102, 241, 0.6)',
    textDecoration: 'none',
  },
  paragraph: {
    background: 'transparent',
    borderBottom: '2px solid rgba(99, 102, 241, 0.6)',
    textDecoration: 'none',
  },
}
