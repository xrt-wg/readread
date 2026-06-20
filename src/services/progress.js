/**
 * 段落解析
 *
 * 此模块定义了「段落」的唯一权威来源。
 * ReaderPage 非 markdown 渲染路径使用此模块的函数。
 *
 * 进度计算已迁移至 scroll% 快照模型——标记时存阅读器顶部栏百分比，
 * 列表端直接读取，不再在此模块中重算。
 */

/**
 * 将文章解析为段落文本数组
 *
 * 段落定义规则（与 ReaderPage MarkdownContent 的 paraIdxRef 递增逻辑一致）:
 *   - markdown 文章: 去除 frontmatter → 归一化 → 引用块内补空行 → 去除 > →
 *     代码块占位 → \n\n+ 分割 → 跳过标题/代码/水平线 → 列表拆分为单项
 *   - 纯文本文章: 归一化 → \n+ 分割（与 parseText() 一致）
 */
export function getParagraphs(article) {
  if (!!article.markdown) {
    return getMarkdownParagraphs(article.markdown)
  }
  return (article.text || '')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split(/\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
}

function getMarkdownParagraphs(markdown) {
  // 归一化换行符
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // 去除 YAML frontmatter
  const body = normalized.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')

  // 引用块处理：
  // 阶段 1：连续 >line 之间补空行（react-markdown 将其解析为独立 <p>）
  let bodyFixed = body
  let prev = ''
  while (bodyFixed !== prev) {
    prev = bodyFixed
    bodyFixed = bodyFixed.replace(/(>[^\n]+\n)(>[^\n]+)/g, '$1\n$2')
  }
  // 阶段 2：去除行首 > 前缀
  const bodyNormalized = bodyFixed.replace(/^>\s?/gm, '')

  // 代码块占位符替换
  const codeBlocks = []
  const bodyWithoutCode = bodyNormalized.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match)
    return `%%CODEBLOCK_${codeBlocks.length - 1}%%`
  })

  // 按空行分割为块
  const blocks = bodyWithoutCode.split(/\n\n+/).map(b => b.trim()).filter(b => b.length > 0)

  const paragraphs = []
  for (const block of blocks) {
    if (/^%%CODEBLOCK_\d+%%$/.test(block)) continue          // 代码块
    if (/^#{1,6}\s/.test(block)) continue                    // h1-h6 标题
    if (/^[-*_]{3,}\s*$/.test(block)) continue               // 水平线

    if (isListBlock(block)) {
      const items = block.split(/\n/).map(l => l.trim()).filter(l => l.length > 0)
      for (const item of items) {
        paragraphs.push(item.replace(/^[-*+]\s+|\d+\.\s+/, '').trim())
      }
    } else {
      paragraphs.push(block)
    }
  }
  return paragraphs
}

function isListBlock(block) {
  const lines = block.split(/\n/)
  return lines.every(l => /^\s*[-*+]\s|^\s*\d+\.\s/.test(l.trim()))
}

