/**
 * HTML 文件提取器 — 从 HTML 中提取正文并按 h2-h4 标题切分为 sections。
 * 使用 Readability + Turndown 提取和转换正文。
 */
import { Readability } from '@mozilla/readability'
import { htmlToMarkdown } from '../../utils/markdownUtils'

/**
 * @param {import('../../types/extractor').ExtractorInput} input
 * @returns {Promise<import('../../types/extractor').ExtractionResult>}
 */
export async function extractFromHtmlFile(input) {
  const htmlContent = input.text
  const fileName = input.fileName || 'untitled.html'

  if (!htmlContent) throw new Error('文件内容为空')

  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlContent, 'text/html')

  // ① h1 → document.title
  let title = fileName.replace(/\.html?$/i, '')
  const h1 = doc.querySelector('h1')
  if (h1?.textContent?.trim()) {
    title = h1.textContent.trim()
  }

  // ② Readability → 提取正文 HTML
  const article = new Readability(doc.cloneNode(true)).parse()
  if (!article?.content) {
    throw new Error('无法从 HTML 文件中提取正文')
  }

  // ③ 按 h2-h4 标题切分
  const sections = parseHtmlSections(article.content)

  // ④ 无标题 → 退化为单 section
  if (sections.length === 0) {
    return {
      meta: { title, format: 'html' },
      sections: [
        {
          heading: null,
          depth:   0,
          order:   0,
          body: {
            text: article.textContent?.trim() || '',
            markdown: htmlToMarkdown(article.content),
          },
        },
      ],
    }
  }

  return {
    meta: { title, format: 'html' },
    sections,
  }
}

/**
 * 解析 HTML 正文，按 h2/h3/h4 标题切分。
 * h2 → depth 0, h3 → depth 1, h4 → depth 2。
 * h5/h6 → depth 2（不增加最大深度）。
 * 标题之间的 HTML → Turndown → markdown + text。
 */
function parseHtmlSections(htmlContent) {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = htmlContent

  const sections = []
  let currentHeading = null
  let currentDepth = 0
  let currentHtml = []
  let order = 0

  function flushSection() {
    const html = currentHtml.join('').trim()
    if (html) {
      const markdown = htmlToMarkdown(html)
      const temp = document.createElement('div')
      temp.innerHTML = html
      const text = temp.textContent?.trim() || ''
      sections.push({
        heading: currentHeading,
        depth:   currentDepth,
        order:   order++,
        body: { text, markdown },
      })
    }
    currentHtml = []
  }

  function getDepth(tagName) {
    switch (tagName) {
      case 'H2': return 0
      case 'H3': return 1
      case 'H4': case 'H5': case 'H6': return 2
      default: return 0
    }
  }

  for (const node of wrapper.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE && /^H[2-6]$/.test(node.tagName)) {
      flushSection()
      currentHeading = node.textContent?.trim() || null
      currentDepth = getDepth(node.tagName)
    } else {
      currentHtml.push(node.nodeType === Node.ELEMENT_NODE ? node.outerHTML : node.textContent || '')
    }
  }

  flushSection()

  return sections
}
