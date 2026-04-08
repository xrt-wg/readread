import { useEffect, useRef } from 'react'
import { Trash2, HeartHandshake, Loader2 } from 'lucide-react'
import { HIGHLIGHT_STYLES, highlightWord } from '../utils/textUtils'

const TYPE_LABEL = {
  word: '单词',
  phrase: '短句',
  sentence: '句子',
  paragraph: '段落',
}

const TYPE_DOT_COLOR = {
  word: '#fbbf24',
  phrase: '#34d399',
  sentence: '#818cf8',
  paragraph: '#818cf8',
}

export default function BookmarkHoverCard({ bookmark, anchorEl, onDelete }) {
  const cardRef = useRef(null)

  useEffect(() => {
    if (!cardRef.current || !anchorEl) return

    const card = cardRef.current
    const anchorRect = anchorEl.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const vw = window.innerWidth

    let x = anchorRect.left
    let y = anchorRect.bottom + 10

    if (x + cardRect.width + 12 > vw) {
      x = vw - cardRect.width - 12
    }
    if (x < 8) x = 8

    const vh = window.innerHeight
    if (anchorRect.bottom + cardRect.height + 20 > vh) {
      y = anchorRect.top - cardRect.height - 10
    }
    if (y < 8) y = 8

    card.style.left = `${x}px`
    card.style.top = `${y}px`
  }, [anchorEl, bookmark])

  if (!bookmark || !anchorEl) return null

  const isShort = bookmark.type === 'word' || bookmark.type === 'phrase'
  const dotColor = TYPE_DOT_COLOR[bookmark.type] ?? '#fbbf24'

  return (
    <div
      ref={cardRef}
      className="animate-pop-in fixed z-40"
      style={{ maxWidth: '320px', minWidth: '200px' }}
      onMouseEnter={() => {}}
    >
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: '#fff',
          boxShadow: '0 6px 32px rgba(28,25,23,0.14), 0 1px 6px rgba(28,25,23,0.06)',
          border: '1px solid rgba(28,25,23,0.08)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: '1px solid rgba(28,25,23,0.06)' }}
        >
          <div className="flex items-center gap-2">
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: dotColor,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: '11px',
                fontFamily: 'DM Sans',
                color: 'var(--ink-muted)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                fontWeight: 500,
              }}
            >
              {TYPE_LABEL[bookmark.type] ?? '收藏'}
            </span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete(bookmark.id)
            }}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition-all"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '11px',
              fontFamily: 'DM Sans',
              color: 'var(--ink-muted)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#fee2e2'
              e.currentTarget.style.color = '#dc2626'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--ink-muted)'
            }}
          >
            <Trash2 size={11} />
            删除
          </button>
        </div>

        {isShort ? (
          /* ── 词 / 短句 ── */
          <div className="px-4 pt-3 pb-2">
            {/* 原词（小斜体） */}
            <p style={{ fontFamily: '"Lora",Georgia,serif', fontSize: '12px', fontStyle: 'italic', color: 'var(--ink-muted)', lineHeight: 1.4, marginBottom: '6px' }}>
              {bookmark.text}
            </p>
            {/* 翻译（主） */}
            {bookmark.translationStatus === 'pending' ? (
              <div className="flex items-center gap-1.5" style={{ marginBottom: '8px' }}>
                <Loader2 size={11} className="animate-spin" style={{ color: 'rgba(28,25,23,0.2)' }} />
                <span style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'rgba(28,25,23,0.3)' }}>翻译生成中…</span>
              </div>
            ) : bookmark.translation ? (
              <p style={{ fontFamily: 'DM Sans', fontSize: '20px', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3, marginBottom: '8px' }}>
                {bookmark.translation}
              </p>
            ) : null}
            {/* 语境句 + 句子译文 */}
            {bookmark.contextSentence && (() => {
              const { before, match, after } = highlightWord(bookmark.contextSentence, bookmark.text)
              return (
                <>
                  <div style={{ height: '1px', background: 'rgba(28,25,23,0.07)', marginBottom: '8px' }} />
                  <p style={{ fontFamily: '"Lora",Georgia,serif', fontSize: '12px', fontStyle: 'italic', color: 'var(--ink-light)', lineHeight: 1.6, marginBottom: bookmark.contextTranslation ? '4px' : 0 }}>
                    {before}
                    {match && <strong style={{ color: 'var(--ink)', fontStyle: 'italic', fontWeight: 700 }}>{match}</strong>}
                    {after}
                  </p>
                  {bookmark.contextTranslation && (
                    <p style={{ fontFamily: 'DM Sans', fontSize: '12px', color: 'var(--ink-muted)', lineHeight: 1.55, opacity: 0.75 }}>
                      {bookmark.contextTranslation}
                    </p>
                  )}
                </>
              )
            })()}
          </div>
        ) : (
          /* ── 句子 / 段落 ── */
          <>
            <div className="px-4 pt-3 pb-1">
              <p style={{ fontFamily: '"Lora",Georgia,serif', fontSize: '13px', fontStyle: 'italic', color: 'var(--ink)', lineHeight: 1.5 }}>
                {bookmark.text}
              </p>
            </div>
            {bookmark.translationStatus === 'pending' ? (
              <div className="px-4 pb-3 flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" style={{ color: 'rgba(28,25,23,0.2)' }} />
                <span style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'rgba(28,25,23,0.3)' }}>翻译生成中…</span>
              </div>
            ) : bookmark.translation ? (
              <div className="px-4 pb-3">
                <p style={{ fontFamily: 'DM Sans', fontSize: '13px', color: 'var(--ink-light)', lineHeight: 1.6 }}>
                  {bookmark.translation}
                </p>
              </div>
            ) : null}
          </>
        )}

        {/* 底部标识 */}
        <div
          className="flex items-center gap-1.5 px-4 py-2"
          style={{ borderTop: '1px solid rgba(28,25,23,0.05)', background: 'rgba(28,25,23,0.015)' }}
        >
          <HeartHandshake size={11} style={{ color: 'var(--gold)' }} />
          <span style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.6 }}>
            已收藏
          </span>
        </div>
      </div>
    </div>
  )
}
