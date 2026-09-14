import { memo, useMemo } from 'react'
import { HIGHLIGHT_STYLES } from '../utils/textUtils'

const BG_TYPES = new Set(['word', 'phrase'])
const UL_TYPES = new Set(['sentence', 'paragraph'])

/** 同层内最新优先、贪心去重叠，返回按 start 升序 */
function resolveRanges(ranges) {
  ranges.sort((a, b) => new Date(b.bookmark.createdAt) - new Date(a.bookmark.createdAt))
  const resolved = []
  for (const r of ranges) {
    if (!resolved.some((o) => r.start < o.end && r.end > o.start)) resolved.push(r)
  }
  return resolved.sort((a, b) => a.start - b.start)
}

/**
 * 将段落文本与收藏标注合并为「背景层 + 下划线层」两层区间。
 * word/phrase 走背景层（面），sentence/paragraph 走下划线层（线），
 * 两层视觉正交、独立消解后嵌套渲染，重叠时二者可同时可见。
 */
function buildLayers(paraText, bookmarks) {
  const ranges = bookmarks
    .map((bm) => ({ start: bm.charOffset, end: bm.charOffset + bm.text.length, bookmark: bm }))
    .filter(
      (r) =>
        r.start >= 0 &&
        r.end <= paraText.length &&
        r.start < r.end &&
        paraText.slice(r.start, r.end) === r.bookmark.text
    )
  return {
    bgRanges: resolveRanges(ranges.filter((r) => BG_TYPES.has(r.bookmark.type))),
    ulRanges: resolveRanges(ranges.filter((r) => UL_TYPES.has(r.bookmark.type))),
  }
}

function bgStyle(bookmark) {
  const hs = HIGHLIGHT_STYLES[bookmark.type] ?? HIGHLIGHT_STYLES.word
  return {
    backgroundColor: hs.background,
    borderRadius: '3px',
    padding: '1px 1px',
    cursor: 'default',
    transition: 'background-color 0.15s',
  }
}

function ulStyle(bookmark) {
  const hs = HIGHLIGHT_STYLES[bookmark.type] ?? HIGHLIGHT_STYLES.sentence
  // 单一 border-bottom：收敛自「border-bottom + text-decoration 双下划线」，
  // 并移除硬编码 textDecorationColor（审核 P4，见决策 D6）
  return {
    borderBottom: hs.borderBottom,
    cursor: 'default',
    transition: 'background-color 0.15s',
  }
}

/** 在 [from, to) 区间内渲染背景层（word/phrase），按区间边界裁剪 */
function renderBgs(text, from, to, bgRanges) {
  const nodes = []
  let cursor = from
  for (const r of bgRanges) {
    const s = Math.max(r.start, from)
    const e = Math.min(r.end, to)
    if (e <= s) continue
    if (s > cursor) nodes.push(text.slice(cursor, s))
    nodes.push(
      <span
        key={`bg-${r.bookmark.id}-${s}-${e}`}
        data-bookmark-id={r.bookmark.id}
        style={bgStyle(r.bookmark)}
      >
        {text.slice(s, e)}
      </span>
    )
    cursor = e
  }
  if (cursor < to) nodes.push(text.slice(cursor, to))
  return nodes
}

const ParagraphRenderer = memo(function ParagraphRenderer({ text, bookmarks, onHoverBookmark }) {
  const { bgRanges, ulRanges } = buildLayers(text, bookmarks)
  const bookmarkMap = useMemo(() => new Map(bookmarks.map((b) => [b.id, b])), [bookmarks])

  // 委托式 hover：mouseover 冒泡到容器，用 closest 取最内层收藏（词优先于句）。
  // else 分支处理「移到非高亮文本」——逐 span onMouseLeave 在嵌套下无法做到这一点。
  const handleOver = (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-bookmark-id]') : null
    if (el) {
      const bm = bookmarkMap.get(el.dataset.bookmarkId)
      if (bm) onHoverBookmark?.(bm, el)
    } else {
      onHoverBookmark?.(null, null)
    }
  }
  const handleLeave = () => onHoverBookmark?.(null, null)

  const nodes = []
  let cursor = 0
  for (const r of ulRanges) {
    if (r.start > cursor) nodes.push(...renderBgs(text, cursor, r.start, bgRanges))
    nodes.push(
      <span key={`ul-${r.bookmark.id}`} data-bookmark-id={r.bookmark.id} style={ulStyle(r.bookmark)}>
        {renderBgs(text, r.start, r.end, bgRanges)}
      </span>
    )
    cursor = r.end
  }
  if (cursor < text.length) nodes.push(...renderBgs(text, cursor, text.length, bgRanges))

  return (
    <span onMouseOver={handleOver} onMouseLeave={handleLeave}>
      {nodes}
    </span>
  )
})

export default ParagraphRenderer
