import { HIGHLIGHT_STYLES } from '../utils/textUtils'

/**
 * 将段落文本与收藏标注合并，生成带高亮的 segment 列表
 * 重叠时以 createdAt 最新的收藏优先
 */
function buildSegments(paraText, bookmarks) {
  if (!bookmarks.length) {
    return [{ text: paraText, bookmark: null }]
  }

  // 构建范围列表，过滤掉越界的
  let ranges = bookmarks
    .map((bm) => ({
      start: bm.charOffset,
      end: bm.charOffset + bm.text.length,
      bookmark: bm,
    }))
    .filter(
      (r) =>
        r.start >= 0 &&
        r.end <= paraText.length &&
        r.start < r.end &&
        paraText.slice(r.start, r.end) === bm_text(r)
    )

  // 按 createdAt 降序排列（最新的优先级最高）
  ranges.sort((a, b) => new Date(b.bookmark.createdAt) - new Date(a.bookmark.createdAt))

  // 贪心去除重叠：最新的先占位，旧的跳过
  const resolved = []
  for (const range of ranges) {
    const overlaps = resolved.some(
      (r) => range.start < r.end && range.end > r.start
    )
    if (!overlaps) resolved.push(range)
  }

  // 按起始位置升序
  resolved.sort((a, b) => a.start - b.start)

  // 构建 segments
  const segments = []
  let cursor = 0
  for (const range of resolved) {
    if (range.start > cursor) {
      segments.push({ text: paraText.slice(cursor, range.start), bookmark: null })
    }
    segments.push({
      text: paraText.slice(range.start, range.end),
      bookmark: range.bookmark,
    })
    cursor = range.end
  }
  if (cursor < paraText.length) {
    segments.push({ text: paraText.slice(cursor), bookmark: null })
  }

  return segments
}

function bm_text(r) {
  return r.bookmark.text
}

export default function ParagraphRenderer({ text, bookmarks, onHoverBookmark }) {
  const segments = buildSegments(text, bookmarks)

  return (
    <>
      {segments.map((seg, i) => {
        if (!seg.bookmark) {
          return <span key={i}>{seg.text}</span>
        }

        const type = seg.bookmark.type
        const hs = HIGHLIGHT_STYLES[type] ?? HIGHLIGHT_STYLES.word
        const isUnderline = type === 'sentence' || type === 'paragraph'

        return (
          <span
            key={i}
            data-bookmark-id={seg.bookmark.id}
            onMouseEnter={(e) => onHoverBookmark?.(seg.bookmark, e.currentTarget)}
            onMouseLeave={() => onHoverBookmark?.(null, null)}
            style={{
              backgroundColor: hs.background,
              borderBottom: hs.borderBottom,
              textDecoration: isUnderline ? 'underline' : 'none',
              textDecorationColor: isUnderline ? 'rgba(99,102,241,0.5)' : undefined,
              textDecorationThickness: isUnderline ? '2px' : undefined,
              textUnderlineOffset: isUnderline ? '3px' : undefined,
              borderRadius: !isUnderline ? '3px' : undefined,
              padding: !isUnderline ? '1px 1px' : undefined,
              cursor: 'default',
              transition: 'background-color 0.15s',
            }}
          >
            {seg.text}
          </span>
        )
      })}
    </>
  )
}
