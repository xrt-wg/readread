/**
 * 调试脚本：复刻 netlify/functions/parse-epub.cjs 的核心逻辑，
 * 观察 TOC heading 与 body.markdown 首行是否重复，以及 sectionId 是否被多个 TOC 节点共用。
 * 用法：node scripts/debug-epub-headings.cjs <epub路径>
 */
const fs = require('fs')
const path = require('path')
const { parseEpub } = require('epub2md')

function flattenTocTree(tocItems, depth = 0, counter = { value: 0 }) {
  const result = []
  for (const item of tocItems) {
    result.push({
      heading:    item.name || null,
      depth,
      order:      counter.value++,
      _sectionId: item.sectionId,
      body:       { text: '', markdown: null },
    })
    if (item.children && item.children.length > 0) {
      result.push(...flattenTocTree(item.children, depth + 1, counter))
    }
  }
  return result
}

const file = process.argv[2]
if (!file) { console.error('用法: node scripts/debug-epub-headings.cjs <epub路径>'); process.exit(1) }

const buf = fs.readFileSync(file)
const epub = parseEpub(buf, { type: 'buffer' })
const { structure, sections } = epub
const toc = structure?.toc

console.log('=== 文件:', path.basename(file))
console.log('=== TOC 存在:', !!toc, '| spine sections 数:', sections?.length)

const extractionSections = toc ? flattenTocTree(toc.tree) : []
const sectionMap = new Map(sections.map(s => [s.id, s]))

// 统计 sectionId 复用
const idCount = {}
for (const es of extractionSections) idCount[es._sectionId] = (idCount[es._sectionId] || 0) + 1
const reused = Object.entries(idCount).filter(([, n]) => n > 1)
console.log('=== 被多个 TOC 节点共用的 sectionId:', reused.length ? reused : '无')

console.log('=== 平铺 sections（TOC heading vs body 首行）===')
for (const es of extractionSections) {
  const epubSection = es._sectionId ? sectionMap.get(es._sectionId) : null
  let firstLine = '(无正文)'
  let headingLine = null
  if (epubSection) {
    try {
      const md = epubSection.toMarkdown?.() || epubSection.htmlString || ''
      const lines = md.split('\n').map(l => l.trim()).filter(Boolean)
      firstLine = lines[0] ? lines[0].slice(0, 60) : '(空)'
      headingLine = lines.find(l => /^#{1,4}\s/.test(l))?.slice(0, 60) ?? null
    } catch (e) { firstLine = `(toMarkdown 报错: ${e.message})` }
  }
  const dup = headingLine && es.heading && headingLine.replace(/^#{1,4}\s+/, '') === es.heading.trim()
  console.log(
    `[order=${es.order} depth=${es.depth}] sid=${es._sectionId}`,
    `\n  TOC heading : ${JSON.stringify(es.heading)}`,
    `\n  body 首行   : ${JSON.stringify(firstLine)}`,
    `\n  body 标题行 : ${JSON.stringify(headingLine)}`,
    dup ? '\n  ⚠️ 与 TOC heading 完全重复' : '',
  )
}
