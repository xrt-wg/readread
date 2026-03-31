const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1'
const presetModels = require('../../config/presetModels.json')

function resolvePresetModel(provider) {
  const config = presetModels[provider]
  if (!config) throw new Error(`Unknown preset provider: ${provider}`)
  const model = config.defaultModel
  if (!model) {
    throw new Error(`Missing defaultModel for ${provider}`)
  }
  return model
}

async function callGemini(prompt, maxTokens, model) {
  const apiKey = process.env.PRESET_GEMINI_API_KEY
  if (!apiKey) throw new Error('Gemini preset key not configured on server')

  const res = await fetch(
    `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
      }),
    }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `Gemini error ${res.status}`)
  }
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
}

async function callDeepSeek(prompt, maxTokens, model) {
  const apiKey = process.env.PRESET_DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DeepSeek preset key not configured on server')

  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message ?? `DeepSeek error ${res.status}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

exports.handler = async function (event) {
  const fnStart = Date.now()
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    }
  }

  const { prompt, maxTokens = 100, provider, requestId } = body
  if (!prompt) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing prompt' }),
    }
  }

  try {
    const providerStart = Date.now()
    let result
    let resolvedModel = ''
    if (provider === 'gemini-preset') {
      resolvedModel = resolvePresetModel(provider)
      result = await callGemini(prompt, maxTokens, resolvedModel)
    } else if (provider === 'deepseek-preset') {
      resolvedModel = resolvePresetModel(provider)
      result = await callDeepSeek(prompt, maxTokens, resolvedModel)
    } else {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Unknown preset provider: ${provider}` }),
      }
    }
    const providerMs = Date.now() - providerStart
    const functionTotalMs = Date.now() - fnStart

    console.log(
      JSON.stringify({
        tag: 'translate_perf',
        requestId: requestId || null,
        provider,
        model: resolvedModel,
        providerMs,
        functionTotalMs,
      })
    )

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        result,
        perf: {
          requestId: requestId || null,
          provider,
          model: resolvedModel,
          providerMs,
          functionTotalMs,
        },
      }),
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        tag: 'translate_perf_error',
        requestId: requestId || null,
        provider,
        message: e.message,
        functionTotalMs: Date.now() - fnStart,
      })
    )
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
    }
  }
}
