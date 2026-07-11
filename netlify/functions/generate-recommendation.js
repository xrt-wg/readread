/**
 * 推荐内容生成 Netlify Function
 *
 * POST /.netlify/functions/generate-recommendation
 * 接收文章全文 + 元信息，返回 AI 生成的推荐内容（intro / keywords / excerpts 及中英对照）。
 */

const {
  resolvePresetModel,
  resolveApiKey,
  callGemini,
  callDeepSeek,
  callKimi,
  callZhipu,
} = require('../lib/aiProviders.cjs')

const presetModels = require('../../config/presetModels.json')
const recConfig = require('../../config/recommendation.json')

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const MAX_INPUT_CHARS = recConfig.tokenLimits?.maxInputChars ?? 100000
const MAX_OUTPUT_TOKENS = recConfig.tokenLimits?.maxOutputTokens ?? 4096
const MAX_KEYWORDS = recConfig.constraints?.maxKeywords ?? 4
const MAX_EXCERPTS = recConfig.constraints?.maxExcerpts ?? 3

// ─── Prompt 构建 ───────────────────────────────────────────────────────────────

function buildPrompt({ articleText, title, author }) {
  const authorDisplay = author || 'Unknown'

  return `You are a content curator for an English reading platform for Chinese learners.
Your task is to generate recommendation content for the following article.

TITLE: ${title}
AUTHOR: ${authorDisplay}
TYPE: article

ARTICLE TEXT:
---
${articleText}
---

Please analyze the article and return a JSON object with the following structure:

{
  "intro": "A compelling recommendation in Chinese (2-4 sentences). Explain why this article is worth reading — what makes it unique, insightful, or valuable for English learners.",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "keywords_trans": ["关键词1", "关键词2", "关键词3"],
  "excerpts": ["verbatim excerpt 1", "verbatim excerpt 2", "verbatim excerpt 3"],
  "excerpts_trans": ["摘录1的中文翻译", "摘录2的中文翻译", "摘录3的中文翻译"]
}

CRITICAL RULES:
1. "intro" MUST be in Chinese (中文), 2-4 sentences, within 250 characters.
2. "keywords" MUST be 3-4 English keywords capturing the main themes.
3. "keywords_trans" MUST be the Chinese translations of the keywords, each within 10 characters.
4. "excerpts" MUST be EXACT verbatim sentences/passages copied from the text above.
   DO NOT modify, paraphrase, or create them.
   Select the 3 most representative passages that capture the article's core argument, key evidence, or most striking observations.
   Each excerpt should be 1-3 sentences, within 400 characters.
5. "excerpts_trans" MUST be natural Chinese translations, each within 500 characters.
6. Return ONLY valid JSON — no markdown fences, no extra commentary.

Now generate the recommendation content:`
}

// ─── JSON 解析容错 ─────────────────────────────────────────────────────────────

function parseAIResponse(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('AI response is empty or invalid')
  }

  // 1. 尝试直接解析
  try { return JSON.parse(raw) } catch { /* continue */ }

  // 2. 去除 markdown fence 后重试
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  try { return JSON.parse(cleaned) } catch { /* continue */ }

  // 3. 尝试提取第一个 { 到最后一个 } 之间的内容
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch { /* continue */ }
  }

  // 4. 解析失败
  throw new Error('AI response could not be parsed as JSON')
}

// ─── 字段校验与补全 ────────────────────────────────────────────────────────────

function normalizeResult(parsed) {
  return {
    intro: String(parsed.intro ?? '').trim(),
    keywords: (Array.isArray(parsed.keywords) ? parsed.keywords : [])
      .map(k => String(k).trim()).filter(Boolean).slice(0, MAX_KEYWORDS),
    keywords_trans: (Array.isArray(parsed.keywords_trans) ? parsed.keywords_trans : [])
      .map(k => String(k).trim()).filter(Boolean).slice(0, MAX_KEYWORDS),
    excerpts: (Array.isArray(parsed.excerpts) ? parsed.excerpts : [])
      .map(e => String(e).trim()).filter(Boolean).slice(0, MAX_EXCERPTS),
    excerpts_trans: (Array.isArray(parsed.excerpts_trans) ? parsed.excerpts_trans : [])
      .map(e => String(e).trim()).filter(Boolean).slice(0, MAX_EXCERPTS),
  }
}

// ─── Provider 路由 ─────────────────────────────────────────────────────────────

async function callProvider(provider, model, prompt, apiKey) {
  const config = presetModels[provider]
  if (!config) throw new Error(`Unknown preset provider: ${provider}`)

  switch (config.kind) {
    case 'gemini':
      return callGemini(prompt, MAX_OUTPUT_TOKENS, model, apiKey)
    case 'openai-compat':
      return callDeepSeek(prompt, MAX_OUTPUT_TOKENS, model, apiKey)
    default:
      throw new Error(`Unsupported provider kind: ${config.kind}`)
  }
}

// ─── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  const fnStart = Date.now()

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  // ── 请求解析 ──
  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON', code: 'INVALID_JSON' }),
    }
  }

  const { articleText, title, author, requestId } = body
  const provider = body.provider || recConfig.activePreset

  // ── 必填校验 ──
  if (!articleText || !title) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing required fields: articleText, title', code: 'MISSING_FIELDS' }),
    }
  }

  // ── 输入上限校验 ──
  if (articleText.length > MAX_INPUT_CHARS) {
    return {
      statusCode: 413,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: `Article text too long (${articleText.length} chars, max ${MAX_INPUT_CHARS})`,
        code: 'INPUT_TOO_LARGE',
      }),
    }
  }

  // ── 核心生成逻辑（含重试 + fallback） ──
  let lastError = null
  const providersToTry = [provider]
  if (recConfig.fallbackPreset && recConfig.fallbackPreset !== provider) {
    providersToTry.push(recConfig.fallbackPreset)
  }

  for (const currentProvider of providersToTry) {
    const isFallback = currentProvider !== provider
    let model, apiKey

    try {
      model = resolvePresetModel(currentProvider)
      apiKey = resolveApiKey(currentProvider)
    } catch (e) {
      lastError = e
      continue // 配置解析失败，尝试下一个 provider
    }

    const prompt = buildPrompt({ articleText, title, author })

    // 同 provider 最多尝试 2 次（首次 + 1 次重试）
    for (let attempt = 0; attempt < 2; attempt++) {
      const providerStart = Date.now()
      try {
        const rawResponse = await callProvider(currentProvider, model, prompt, apiKey)
        const parsed = parseAIResponse(rawResponse)
        const result = normalizeResult(parsed)
        const providerMs = Date.now() - providerStart
        const functionTotalMs = Date.now() - fnStart

        console.log(JSON.stringify({
          tag: 'recommendation_perf',
          requestId: requestId || null,
          provider: currentProvider,
          model,
          attempt: attempt + 1,
          fallback: isFallback,
          providerMs,
          functionTotalMs,
          inputChars: articleText.length,
        }))

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            result,
            perf: {
              requestId: requestId || null,
              provider: currentProvider,
              model,
              attempt: attempt + 1,
              fallback: isFallback || undefined,
              providerMs,
              functionTotalMs,
              inputChars: articleText.length,
            },
          }),
        }
      } catch (e) {
        lastError = e
        const providerMs = Date.now() - providerStart
        console.warn(JSON.stringify({
          tag: 'recommendation_attempt_failed',
          requestId: requestId || null,
          provider: currentProvider,
          model,
          attempt: attempt + 1,
          fallback: isFallback,
          providerMs,
          error: e.message,
        }))

        // JSON 解析失败 → 同 provider 重试；API 错误 → 切换 provider
        if (e.message?.includes('could not be parsed')) {
          continue // 同 provider 重试
        }
        break // API 错误，不再同 provider 重试，直接切换
      }
    }
  }

  // ── 所有 provider 均失败 ──
  console.error(JSON.stringify({
    tag: 'recommendation_all_failed',
    requestId: requestId || null,
    functionTotalMs: Date.now() - fnStart,
    lastError: lastError?.message,
  }))

  return {
    statusCode: 500,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: lastError?.message || 'All providers failed',
      code: 'AI_API_ERROR',
    }),
  }
}
