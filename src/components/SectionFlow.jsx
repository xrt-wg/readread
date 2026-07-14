import { memo, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Bookmark } from 'lucide-react'
import ParagraphRenderer from './ParagraphRenderer'
import { extractRawText } from '../utils/markdownUtils'

/**
 * 将纯文本按空行切分为段落数组。
 */
export function parseText(text) {
  return (text ?? '')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

function checkHasImage(children) {
  if (!children) return false
  if (Array.isArray(children)) return children.some(checkHasImage)
  if (typeof children === 'object' && children !== null) {
    if (children.type === 'img') return true
    if (typeof children.type === 'function' && 'src' in (children.props ?? {})) return true
    if (children.props?.children) return checkHasImage(children.props.children)
  }
  return false
}

/** 判断某段落是否为当前阅读标记所在段（section 感知）。 */
function isMarkedPara(readingMark, sectionId, idx) {
  return (readingMark?.sectionId ?? null) === (sectionId ?? null)
    && readingMark?.paragraphIndex === idx
    && !readingMark?.completed
}

/**
 * 渲染单个 section 的 Markdown 正文。
 * paraIdx 在本实例内从 0 计数——与 `sectionId + paragraphIndex` 三级索引一致。
 */
export const MarkdownContent = memo(function MarkdownContent({ markdown, sectionId = null, bookmarks, fontSize, onHoverBookmark, readingMark, onSetReadingMark }) {
  const paraIdxRef = useRef(0)
  paraIdxRef.current = 0
  const bookmarksRef = useRef(bookmarks)
  bookmarksRef.current = bookmarks
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize
  const onHoverRef = useRef(onHoverBookmark)
  onHoverRef.current = onHoverBookmark
  const onSetReadingMarkRef = useRef(onSetReadingMark)
  onSetReadingMarkRef.current = onSetReadingMark

  const components = useMemo(() => ({
    p({ children }) {
      const idx = paraIdxRef.current++
      const style = { fontFamily: '"Lora", Georgia, serif', fontSize: `${fontSizeRef.current}px`, lineHeight: 1.9, color: 'var(--ink-light)', marginBottom: '1.8em', letterSpacing: '0.01em' }
      if (checkHasImage(children)) {
        return <p data-para-index={idx} style={style}>{children}</p>
      }
      const rawText = extractRawText(children)
      const paraBMs = bookmarksRef.current.filter((b) => b.paragraphIndex === idx)
      const isMarked = isMarkedPara(readingMark, sectionId, idx)
      return (
        <div className="group relative">
          <button
            onClick={() => onSetReadingMarkRef.current(idx)}
            title={isMarked ? '取消阅读标记' : '标记读到这里'}
            className={isMarked ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity duration-150'}
            style={{
              position: 'absolute',
              left: '-32px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
              color: isMarked ? 'var(--gold)' : 'var(--ink-muted)',
            }}
          >
            <Bookmark size={14} fill={isMarked ? 'currentColor' : 'none'} />
          </button>
          <p data-para-index={idx} style={style}>
            <ParagraphRenderer text={rawText} bookmarks={paraBMs} onHoverBookmark={onHoverRef.current} />
          </p>
        </div>
      )
    },
    h1: ({ children }) => <h1 className="article-h1">{children}</h1>,
    h2: ({ children }) => <h2 className="article-h2">{children}</h2>,
    h3: ({ children }) => <h3 className="article-h3">{children}</h3>,
    h4: ({ children }) => <h4 className="article-h4">{children}</h4>,
    ul: ({ children }) => <ul className="article-ul">{children}</ul>,
    ol: ({ children }) => <ol className="article-ol">{children}</ol>,
    li({ children }) {
      const idx = paraIdxRef.current++
      const rawText = extractRawText(children)
      const paraBMs = bookmarksRef.current.filter((b) => b.paragraphIndex === idx)
      return (
        <li data-para-index={idx} className="article-li">
          <ParagraphRenderer text={rawText} bookmarks={paraBMs} onHoverBookmark={onHoverRef.current} />
        </li>
      )
    },
    blockquote: ({ children }) => <blockquote className="article-quote">{children}</blockquote>,
    code({ inline, children }) {
      return inline
        ? <code className="article-inline-code">{children}</code>
        : <pre className="article-code-block"><code>{children}</code></pre>
    },
    img({ src, alt }) {
      return (
        <img
          src={src}
          alt={alt ?? ''}
          onError={(e) => { e.currentTarget.style.display = 'none' }}
          style={{
            maxWidth: '100%',
            height: 'auto',
            borderRadius: '8px',
            margin: '1em 0',
            display: 'block',
          }}
        />
      )
    },
  }), [readingMark, sectionId])

  const fmMatch = markdown?.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const frontmatterFields = fmMatch
    ? fmMatch[1].split(/\r?\n/).filter(Boolean).map((line) => {
        const colon = line.indexOf(':')
        return colon === -1
          ? { key: null, val: line }
          : { key: line.slice(0, colon).trim(), val: line.slice(colon + 1).trim() }
      })
    : null
  const body = fmMatch ? markdown.slice(fmMatch[0].length) : markdown
  const fmText = frontmatterFields
    ? frontmatterFields.map(({ key, val }) => (key ? `${key} · ${val}` : val)).join('\n')
    : ''

  return (
    <>
      {frontmatterFields && (
        <div
          data-para-index="-1"
          className="article-quote"
          style={{
            marginBottom: '1.8em',
            fontFamily: '"Lora", Georgia, serif',
            fontSize: `${fontSizeRef.current}px`,
            lineHeight: 1.9,
            whiteSpace: 'pre-line',
          }}
        >
          <ParagraphRenderer
            text={fmText}
            bookmarks={bookmarksRef.current.filter((b) => b.paragraphIndex === -1)}
            onHoverBookmark={onHoverRef.current}
          />
        </div>
      )}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {body}
      </ReactMarkdown>
    </>
  )
})

/**
 * 渲染单个 section 的纯文本正文（markdown 缺失时的降级路径）。
 */
function PlainTextContent({ text, sectionId = null, bookmarks, fontSize, onHoverBookmark, readingMark, onSetReadingMark }) {
  const paragraphs = parseText(text)
  return paragraphs.map((para, i) => {
    const paraBMs = bookmarks.filter((b) => b.paragraphIndex === i)
    const isMarked = isMarkedPara(readingMark, sectionId, i)
    return (
      <div key={i} className="group relative">
        <button
          onClick={() => onSetReadingMark(i)}
          title={isMarked ? '取消阅读标记' : '标记读到这里'}
          className={isMarked ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity duration-150'}
          style={{
            position: 'absolute',
            left: '-32px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '6px',
            color: isMarked ? 'var(--gold)' : 'var(--ink-muted)',
          }}
        >
          <Bookmark size={14} fill={isMarked ? 'currentColor' : 'none'} />
        </button>
        <p
          data-para-index={i}
          style={{
            fontFamily: '"Lora", Georgia, serif',
            fontSize: `${fontSize}px`,
            lineHeight: 1.9,
            color: 'var(--ink-light)',
            marginBottom: '1.6em',
            letterSpacing: '0.01em',
          }}
        >
          <ParagraphRenderer text={para} bookmarks={paraBMs} onHoverBookmark={onHoverBookmark} />
        </p>
      </div>
    )
  })
}

/** depth → 内联标题标签。0→h2, 1→h3, ≥2→h4。 */
function headingClassForDepth(depth) {
  if (depth <= 0) return 'article-h2'
  if (depth === 1) return 'article-h3'
  return 'article-h4'
}

/**
 * 分节堆叠渲染：把若干 section 顺序铺开为一条连续内容流。
 *
 * - 每个 section 前按 `heading + depth` 重建内联标题（section.body 不含标题行）。
 * - 每个 section 各自一个内容渲染器，paraIdx 逐节从 0 计数。
 * - `sectionScoped`：多 section 文档按 section.id 关联书签/标记；单 section 文档关联 null（向后兼容）。
 *
 * @param {Object} props
 * @param {import('../types/document').Section[]} props.sections
 * @param {boolean} props.sectionScoped
 */
export default function SectionFlow({ sections, sectionScoped, bookmarks, fontSize, onHoverBookmark, readingMark, onSetReadingMark }) {
  return (
    <>
      {sections.map((section) => {
        const sid = sectionScoped ? section.id : null
        const sectionBookmarks = sectionScoped
          ? bookmarks.filter((b) => (b.sectionId ?? null) === section.id)
          : bookmarks
        const HeadingTag = section.depth >= 1 ? (section.depth === 1 ? 'h3' : 'h4') : 'h2'
        return (
          <div key={section.id} data-section-id={section.id}>
            {section.heading && (
              <HeadingTag className={headingClassForDepth(section.depth)}>{section.heading}</HeadingTag>
            )}
            {section.body.markdown != null ? (
              <MarkdownContent
                markdown={section.body.markdown}
                sectionId={sid}
                bookmarks={sectionBookmarks}
                fontSize={fontSize}
                onHoverBookmark={onHoverBookmark}
                readingMark={readingMark}
                onSetReadingMark={(idx) => onSetReadingMark(idx, sid)}
              />
            ) : (
              <PlainTextContent
                text={section.body.text}
                sectionId={sid}
                bookmarks={sectionBookmarks}
                fontSize={fontSize}
                onHoverBookmark={onHoverBookmark}
                readingMark={readingMark}
                onSetReadingMark={(idx) => onSetReadingMark(idx, sid)}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
