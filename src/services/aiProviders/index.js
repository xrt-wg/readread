import * as gemini from './gemini'
import { makeAdapter, openaiModels, groqModels, deepseekModels, kimiModels } from './openaiCompat'

const openaiTranslate = makeAdapter('https://api.openai.com/v1')
const groqTranslate = makeAdapter('https://api.groq.com/openai/v1')
const deepseekTranslate = makeAdapter('https://api.deepseek.com/v1')
const kimiTranslate = makeAdapter('https://api.moonshot.cn/v1')

function makePresetTranslate(presetKey) {
  return async function (prompt, _model, _apiKey, signal, maxTokens) {
    const res = await fetch('/.netlify/functions/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, maxTokens, provider: presetKey }),
      signal,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error ?? `服务暂时不可用 (${res.status})`)
    }
    const data = await res.json()
    return data.result ?? ''
  }
}

export const PROVIDERS = {
  'gemini-preset': {
    label: 'Google Gemini',
    region: '美国',
    preset: true,
    models: ['gemini-2.0-flash'],
    translate: makePresetTranslate('gemini-preset'),
  },
  'deepseek-preset': {
    label: 'DeepSeek',
    region: '中国',
    preset: true,
    models: ['deepseek-chat'],
    translate: makePresetTranslate('deepseek-preset'),
  },
  gemini: {
    label: 'Google Gemini',
    models: gemini.models,
    translate: gemini.translate,
  },
  openai: {
    label: 'OpenAI',
    models: openaiModels,
    translate: openaiTranslate,
  },
  groq: {
    label: 'Groq',
    models: groqModels,
    translate: groqTranslate,
  },
  deepseek: {
    label: 'DeepSeek',
    models: deepseekModels,
    translate: deepseekTranslate,
  },
  kimi: {
    label: 'Kimi',
    models: kimiModels,
    translate: kimiTranslate,
  },
}

function buildPrompt(text, type, context) {
  if (type === 'word' || type === 'phrase') {
    return `Translate the word or phrase "${text}" as used in this sentence: "${context}". Reply with ONLY its Chinese meaning in this context, no explanation, maximum 8 characters.`
  }
  if (type === 'sentence') {
    return `Translate the following English sentence to Chinese. Reply with ONLY the Chinese translation, no explanation:\n\n${text}`
  }
  return `Translate the following English text to Chinese. Reply with ONLY the Chinese translation, no explanation:\n\n${text}`
}

function getMaxTokens(type) {
  if (type === 'word' || type === 'phrase') return 20
  if (type === 'sentence') return 200
  return 600
}

export function translateText({ provider, model, apiKeys }, text, type, context, signal) {
  const p = PROVIDERS[provider]
  if (!p) throw new Error(`Unknown provider: ${provider}`)
  if (!p.preset) {
    const key = apiKeys?.[provider]
    if (!key) throw new Error(`Missing API key for ${provider}`)
  }
  const key = apiKeys?.[provider] ?? ''
  const prompt = buildPrompt(text, type, context)
  const maxTokens = getMaxTokens(type)
  return p.translate(prompt, model, key, signal, maxTokens)
}
