import * as gemini from './gemini'
import { makeAdapter, openaiModels, groqModels, deepseekModels, kimiModels } from './openaiCompat'
import presetModels from '../../../config/presetModels.json'
import { prompts, tokenLimits, aiConfig } from '../../../config/translation'

const openaiTranslate = makeAdapter('https://api.openai.com/v1')
const groqTranslate = makeAdapter('https://api.groq.com/openai/v1')
const deepseekTranslate = makeAdapter('https://api.deepseek.com/v1')
const kimiTranslate = makeAdapter('https://api.moonshot.cn/v1')

function makePresetTranslate(presetKey) {
  return async function (prompt, model, _apiKey, signal, maxTokens) {
    const startedAt = Date.now()
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
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
      console.info('[AI_PERF_CLIENT_REQ]', {
        requestId,
        provider: presetKey,
        model,
        totalMs: Date.now() - startedAt,
        ok: true,
      })
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
    } catch (e) {
      console.info('[AI_PERF_CLIENT_REQ]', {
        requestId,
        provider: presetKey,
        model,
        totalMs: Date.now() - startedAt,
        ok: false,
        error: e.message ?? '请求失败',
      })
      throw e
    }
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
  if (type === 'word_phrase_bundle') return prompts.bookmarkCard(text, context)
  if (type === 'sentence') return prompts.sentence(text)
  return prompts.paragraph(text)
}

function getMaxTokens(type) {
  if (type === 'word_phrase_bundle') return tokenLimits.bookmarkCard
  if (type === 'sentence') return tokenLimits.sentence
  return tokenLimits.paragraph
}

export function getBookmarkAIConfig() {
  const preset = aiConfig.activePreset
  const model = presetModels[preset]?.defaultModel ?? ''
  return { provider: preset, model, apiKeys: {} }
}

export function getFallbackAIConfig() {
  const preset = aiConfig.fallbackPreset
  if (!preset) return null
  const model = presetModels[preset]?.defaultModel ?? ''
  return { provider: preset, model, apiKeys: {} }
}

function parseWordPhraseBundle(raw) {
  const fallback = {
    meaning: (raw ?? '').trim(),
    contextTranslation: '',
  }
  const str = (raw ?? '').trim()
  if (!str) return fallback

  const cleaned = str
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  try {
    const parsed = JSON.parse(cleaned)
    return {
      meaning: String(parsed?.meaning ?? parsed?.wordMeaning ?? '').trim(),
      contextTranslation: String(parsed?.contextTranslation ?? parsed?.sentenceTranslation ?? '').trim(),
    }
  } catch {
    return fallback
  }
}

export async function translateText({ provider, model, apiKeys }, text, type, context, signal) {
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
  const out = await p.translate(prompt, resolvedModel, key, signal, maxTokens)
  if (type === 'word_phrase_bundle') {
    return parseWordPhraseBundle(out)
  }
  return out
}
