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
