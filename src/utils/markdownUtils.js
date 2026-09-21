import TurndownService from 'turndown'

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})

td.remove(['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'aside'])

td.addRule('preserveFigureCaption', {
  filter: 'figcaption',
  replacement: (content) => `*${content.trim()}*\n\n`,
})

export function htmlToMarkdown(html) {
  if (!html) return ''
  return td.turndown(html)
}

export function extractRawText(children) {
  if (children == null) return ''
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractRawText).join('')
  if (children?.props?.children !== undefined) return extractRawText(children.props.children)
  return ''
}

/**
 * 将 react-markdown 的 children 拍平为「段」数组：[{ text, href, img? }]。
 * 拼接所有段的 text 与 extractRawText 结果一致，因此收藏 charOffset 不受影响；
 * 同时保留链接段的 href、图片段的 src/alt，供阅读页在纯文本渲染管线中恢复链接与图片。
 * 相邻同 href 的纯文本段会合并，减少渲染碎片。
 */
export function extractSegments(children) {
  const segs = []
  const push = (text, href) => {
    if (!text) return
    const last = segs[segs.length - 1]
    if (last && !last.img && last.href === href) last.text += text
    else segs.push({ text, href })
  }
  const walk = (node, href) => {
    if (node == null) return
    if (typeof node === 'string' || typeof node === 'number') { push(String(node), href); return }
    if (Array.isArray(node)) { node.forEach((n) => walk(n, href)); return }
    if (node?.props) {
      const t = node.type
      // 默认渲染器下 type 为 'img'；被 components 映射覆盖后 type 为函数，凭 props.src 识别。
      // 图片占 0 个字符，收藏偏移天然兼容；图片段独立成段、不与文本段合并。
      const isImg = (t === 'img' || typeof t === 'function') && typeof node.props.src === 'string'
      if (isImg) {
        segs.push({ text: '', href, img: { src: node.props.src, alt: node.props.alt ?? '' } })
        return
      }
      const nodeHref = node.props.href
      // 默认渲染器下 type 为 'a'；被 components 映射覆盖后 type 为函数，凭 props.href 识别
      const isLink = (t === 'a' || typeof t === 'function') && typeof nodeHref === 'string'
      walk(node.props.children, isLink ? nodeHref : href)
    }
  }
  walk(children, null)
  return segs
}
