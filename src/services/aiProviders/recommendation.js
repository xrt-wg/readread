/**
 * 推荐内容生成 — 前端 AI 服务层
 *
 * 封装对 /.netlify/functions/generate-recommendation 的调用。
 */

import recConfig from '../../../config/recommendation.json'

/** @typedef {Object} GeneratedContent
 *  @property {string}   intro
 *  @property {string[]} keywords
 *  @property {string[]} keywords_trans
 *  @property {string[]} excerpts
 *  @property {string[]} excerpts_trans
 */

/**
 * 调用推荐内容生成 AI。
 *
 * @param {Object} params
 * @param {string}   params.articleText — 文章全文
 * @param {string}   params.title       — 文章标题
 * @param {string}  [params.author]     — 作者（可选）
 * @param {string}  [params.kind]       — 'article' | 'book'，默认 'article'
 * @param {AbortSignal} params.signal   — AbortController.signal（由弹窗组件创建）
 * @returns {Promise<GeneratedContent>}
 */
export async function generateRecommendationContent({ articleText, title, author, kind = 'article', signal }) {
  const provider = recConfig.activePreset
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const startedAt = Date.now()
  let res

  try {
    res = await fetch('/.netlify/functions/generate-recommendation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        articleText,
        title,
        author: author || undefined,
        kind,
        provider,
        requestId,
      }),
      signal,
    })
  } catch (e) {
    // 区分 AbortError（超时/用户取消）和网络错误
    if (e.name === 'AbortError') {
      const err = new Error('生成超时，请重试或手动填写')
      err.code = 'TIMEOUT'
      throw err
    }
    const err = new Error('网络请求失败，请检查网络连接后重试')
    err.code = 'NETWORK_ERROR'
    throw err
  }

  const totalMs = Date.now() - startedAt

  // 413 — 输入过大
  if (res.status === 413) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.error || '文章过长，无法生成推荐内容')
    err.code = 'INPUT_TOO_LARGE'
    throw err
  }

  // 非 200 → function 返回错误
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.error || `服务暂时不可用 (${res.status})`)
    err.code = body.code || 'AI_API_ERROR'
    throw err
  }

  const data = await res.json()
  const result = data.result

  if (!result) {
    const err = new Error('AI 返回内容为空')
    err.code = 'EMPTY_RESULT'
    throw err
  }

  console.info('[AI_RECOMMENDATION_PERF]', {
    requestId,
    provider: data.perf?.provider,
    model: data.perf?.model,
    totalMs,
    inputChars: data.perf?.inputChars,
    fallback: data.perf?.fallback,
  })

  return {
    intro: result.intro || '',
    keywords: result.keywords || [],
    keywords_trans: result.keywords_trans || [],
    excerpts: result.excerpts || [],
    excerpts_trans: result.excerpts_trans || [],
  }
}
