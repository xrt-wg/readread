/**
 * URL 提取器 — 抓取网页文章并提取正文。
 * 复用现有的三级代理链 + Readability + Turndown。
 */
import { fetchArticleFromUrl } from '../urlImport'

/**
 * @param {import('../../types/extractor').ExtractorInput} input
 * @param {AbortSignal} [signal]
 * @returns {Promise<import('../../types/extractor').ExtractionResult>}
 */
export async function extractFromUrl(input, signal) {
  const url = input.url
  if (!url) throw new Error('缺少 URL 参数')

  const { title, text, markdown } = await fetchArticleFromUrl(url, signal)

  return {
    meta: {
      title,
      format: 'url',
    },
    sections: [
      {
        heading: null,
        depth:   0,
        order:   0,
        body: {
          text,
          markdown: markdown ?? null,
        },
      },
    ],
  }
}
