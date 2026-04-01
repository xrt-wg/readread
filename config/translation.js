// 直译服务：弹窗翻译使用
export const directConfig = {
  activeProvider: 'myMemory', // 可选：'myMemory' | 'deepl' | 'youdao'
}

// AI 精译服务：收藏卡片使用
export const aiConfig = {
  activePreset: 'deepseek-preset', // 可选：'gemini-preset' | 'deepseek-preset'
}

// Prompt 模板
export const prompts = {
  // 词/短句收藏卡片：返回 JSON {meaning, contextTranslation}
  bookmarkCard: (word, context) =>
    `You are a translation assistant.
Translate according to the context and return STRICT JSON only (no markdown, no explanation):
{"meaning":"...","contextTranslation":"..."}

Rules:
- "meaning": concise Chinese meaning of "${word}" in this context, <= 12 Chinese characters.
- "contextTranslation": Chinese translation of this sentence: "${context}".
- Keep wording natural and accurate.`,

  // 句子收藏卡片：返回中文译文字符串
  sentence: (text) =>
    `Translate the following English sentence to Chinese. Reply with ONLY the Chinese translation, no explanation:\n\n${text}`,

  // 段落收藏卡片：返回中文译文字符串
  paragraph: (text) =>
    `Translate the following English text to Chinese. Reply with ONLY the Chinese translation, no explanation:\n\n${text}`,
}

// Token 上限
export const tokenLimits = {
  bookmarkCard: 260,
  sentence: 200,
  paragraph: 600,
}
