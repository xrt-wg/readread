/**
 * Markdown 文件提取器 — 将 Markdown 内容按 ## / ### / #### 标题切分为 sections。
 * 支持 YAML frontmatter。
 */

/**
 * @param {import('../../types/extractor').ExtractorInput} input
 * @returns {Promise<import('../../types/extractor').ExtractionResult>}
 */
export async function extractFromMarkdownFile(input) {
  const content = input.text
  const fileName = input.fileName || 'untitled.md'

  if (!content) throw new Error('文件内容为空')

  // ① 解析 Frontmatter
  let title = fileName.replace(/\.(?:md|markdown)$/i, '')
  let body = content

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (fmMatch) {
    body = content.slice(fmMatch[0].length)
    const titleMatch = fmMatch[1].match(/^(?:title|name)\s*:\s*(.+)$/m)
    if (titleMatch) title = titleMatch[1].trim()
  }

  // ② 按 ## / ### / #### 标题切分
  const sections = parseMarkdownSections(body)

  // ③ 无标题 → 退化为单 section
  if (sections.length === 0) {
    return {
      meta: { title, format: 'markdown' },
      sections: [
        {
          heading: null,
          depth:   0,
          order:   0,
          body: {
            text: body.trim(),
            markdown: body.trim(),
          },
        },
      ],
    }
  }

  return {
    meta: { title, format: 'markdown' },
    sections,
  }
}

/**
 * 扫描 Markdown 正文中的 ## / ### / #### 标题，切分为 ExtractionSection 数组。
 * ##  → depth 0, ### → depth 1, #### → depth 2。
 * 第一个标题之前的正文归入 heading=null, depth=0 的 section。
 */
function parseMarkdownSections(mdText) {
  const lines = mdText.split('\n')
  const sections = []
  let currentHeading = null
  let currentDepth = 0
  let currentLines = []
  let order = 0

  function flushSection() {
    const text = currentLines.join('\n').trim()
    if (text) {
      sections.push({
        heading: currentHeading,
        depth:   currentDepth,
        order:   order++,
        body: {
          text,
          markdown: text,
        },
      })
    }
    currentLines = []
  }

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/)
    const h3 = line.match(/^###\s+(.+)/)
    const h4 = line.match(/^####\s+(.+)/)

    if (h2) {
      flushSection()
      currentHeading = h2[1].trim()
      currentDepth = 0
    } else if (h3) {
      flushSection()
      currentHeading = h3[1].trim()
      currentDepth = 1
    } else if (h4) {
      flushSection()
      currentHeading = h4[1].trim()
      currentDepth = 2
    } else {
      currentLines.push(line)
    }
  }

  flushSection()

  return sections
}
