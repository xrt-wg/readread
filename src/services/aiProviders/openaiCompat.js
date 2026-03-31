export function makeAdapter(baseURL) {
  return async function translate(prompt, model, apiKey, signal, maxTokens = 20) {
    const res = await fetch(`${baseURL}/chat/completions`, {
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
      signal,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message ?? `API error ${res.status}`)
    }

    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() ?? ''
  }
}

export const openaiModels = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o']
export const groqModels = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'gemma2-9b-it']
export const deepseekModels = ['deepseek-chat', 'deepseek-reasoner']
export const kimiModels = ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
