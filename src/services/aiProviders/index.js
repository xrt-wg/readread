import * as gemini from './gemini'
import { makeAdapter, openaiModels, groqModels, deepseekModels, kimiModels } from './openaiCompat'
import presetModels from '../../../config/presetModels.json'

const openaiTranslate = makeAdapter('https://api.openai.com/v1')
const groqTranslate = makeAdapter('https://api.groq.com/openai/v1')
const deepseekTranslate = makeAdapter('https://api.deepseek.com/v1')
const kimiTranslate = makeAdapter('https://api.moonshot.cn/v1')

function makePresetTranslate(presetKey) {
  return async function (prompt, model, _apiKey, signal, maxTokens) {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const res = await fetch('/.netlify/functions/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, maxTokens, provider: presetKey, model, requestId }),
      signal,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error ?? `服务暂时不可用 (${res.status})`)
    }
    const data = await res.json()
    if (data.perf) {
      console.info('[AI_PERF_FUNCTION]', {
        requestId: data.perf.requestId || requestId,
        provider: data.perf.provider,
        model: data.perf.model,
        providerMs: data.perf.providerMs,
        functionTotalMs: data.perf.functionTotalMs,
      })
    }
    return data.result ?? ''
  }
}

const presetProviders = Object.fromEntries(
  Object.entries(presetModels).map(([id, info]) => [
    id,
    {
      label: info.label,
      preset: true,
      defaultModel: info.defaultModel,
      models: [info.defaultModel],
      translate: makePresetTranslate(id),
    },
  ])
)

export const PROVIDERS = {
  ...presetProviders,
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
  const resolvedModel = p.preset ? p.defaultModel : model
  const prompt = buildPrompt(text, type, context)
  const maxTokens = getMaxTokens(type)
  return p.translate(prompt, resolvedModel, key, signal, maxTokens)
}
