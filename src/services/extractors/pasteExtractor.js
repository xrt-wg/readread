/**
 * 粘贴文本提取器 — 纯文本直接包装为单 section ExtractionResult。
 */

/**
 * @param {import('../../types/extractor').ExtractorInput} input
 * @returns {Promise<import('../../types/extractor').ExtractionResult>}
 */
export async function extractFromPastedText(input) {
  const text = input.text
  const title = input.title || '未命名文章'

  if (!text?.trim()) throw new Error('文本内容为空')

  return {
    meta: {
      title,
      format: 'paste',
    },
    sections: [
      {
        heading: null,
        depth:   0,
        order:   0,
        body: {
          text: text.trim(),
          markdown: text.trim(),
        },
      },
    ],
  }
}
