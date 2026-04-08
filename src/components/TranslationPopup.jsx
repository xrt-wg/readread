import { useEffect, useRef } from 'react'
import { Loader2, X, Languages, Heart, HeartHandshake } from 'lucide-react'

const TYPE_LABEL = {
  word: '单词',
  phrase: '短句',
  sentence: '句子',
  paragraph: '段落',
}

export default function TranslationPopup({
  selectedText,
  selectionType,
  position,
  loading,
  result,
  error,
  onClose,
  onBookmark,
  isBookmarked,
}) {
  const popupRef = useRef(null)

  useEffect(() => {
    if (!popupRef.current || !position) return

    const popup = popupRef.current
    const rect = popup.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let { x, y } = position

    if (x + rect.width + 16 > vw) {
      x = vw - rect.width - 16
    }
    if (x < 8) x = 8

    if (y + rect.height + 16 > vh) {
      const selTop = position.selectionTop ?? (position.y - 36)
      y = selTop - rect.height - 12
      if (y < 8) y = 8
    }

    popup.style.left = `${x}px`
    popup.style.top = `${y}px`
  }, [position, result, loading])

  if (!position) return null

  const isShort = selectionType === 'word' || selectionType === 'phrase'
  const truncated = selectedText.length > 160 ? selectedText.slice(0, 160) + '…' : selectedText

  return (
    <div
      ref={popupRef}
      className="animate-pop-in fixed z-50"
      style={{
        left: position.x,
        top: position.y,
        maxWidth: isShort ? '300px' : '400px',
        minWidth: isShort ? '220px' : '280px',
      }}
    >
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: '#1c1917',
          boxShadow: '0 8px 40px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.18)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center gap-2">
            <Languages size={13} style={{ color: 'var(--gold-light)', opacity: 0.9 }} />
            <span style={{ fontFamily: 'DM Sans', color: 'rgba(255,255,255,0.45)', fontSize: '11px' }}>
              {TYPE_LABEL[selectionType] ?? '文本'} · EN → ZH
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-full flex items-center justify-center transition-all hover:bg-white/10"
            style={{ width: 22, height: 22, background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <X size={12} style={{ color: 'rgba(255,255,255,0.4)' }} />
          </button>
        </div>

        {isShort ? (
          /* ── 词 / 短句 ── */
          <>
            {/* 选中词（小字参考） */}
            <div className="px-4 pt-3 pb-1.5">
              <p style={{ fontFamily: '"Lora",Georgia,serif', color: 'rgba(255,255,255,0.35)', fontSize: '13px', fontStyle: 'italic', lineHeight: 1.4 }}>
                {truncated}
              </p>
            </div>

            {/* 直译词义（主） */}
            <div className="px-4 pb-2.5">
              {loading && (
                <div className="flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin" style={{ color: 'var(--gold-light)' }} />
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px', fontFamily: 'DM Sans' }}>翻译中…</span>
                </div>
              )}
              {result && !loading && (
                <p style={{ fontFamily: 'DM Sans', color: 'rgba(255,255,255,0.95)', fontSize: '22px', fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.01em' }}>
                  {result}
                </p>
              )}
              {error && !loading && !result && (
                <p style={{ color: 'rgba(255,100,100,0.7)', fontSize: '11px', fontFamily: 'DM Sans' }}>{error}</p>
              )}
            </div>

            <div className="pb-2" />
          </>
        ) : (
          /* ── 句子 / 段落：直接翻译 ── */
          <>
            {/* 选中原文 */}
            <div className="px-4 pt-3 pb-2">
              <p
                style={{
                  fontFamily: '"Lora", Georgia, serif',
                  color: 'rgba(255,255,255,0.65)',
                  fontSize: '13px',
                  fontStyle: 'italic',
                  lineHeight: 1.5,
                }}
              >
                {truncated}
              </p>
            </div>
            <div className="mx-4" style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />
            <div className="px-4 py-3">
              {loading && (
                <div className="flex items-center gap-2.5">
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--gold-light)' }} />
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '13px', fontFamily: 'DM Sans' }}>翻译中…</span>
                </div>
              )}
              {error && !loading && (
                <p style={{ color: '#f87171', fontSize: '13px', fontFamily: 'DM Sans' }}>{error}</p>
              )}
              {result && !loading && (
                <p
                  style={{
                    fontFamily: 'DM Sans',
                    color: 'rgba(255,255,255,0.92)',
                    fontSize: '14px',
                    fontWeight: 400,
                    lineHeight: 1.65,
                  }}
                >
                  {result}
                </p>
              )}
            </div>
          </>
        )}

        {/* 收藏按钮 */}
        <div
          className="px-4 py-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <button
            onClick={onBookmark}
            disabled={isBookmarked}
            className="flex items-center gap-2 rounded-xl w-full justify-center transition-all"
            style={{
              padding: '8px 12px',
              background: isBookmarked ? 'rgba(196,154,60,0.15)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${isBookmarked ? 'rgba(196,154,60,0.4)' : 'rgba(255,255,255,0.08)'}`,
              color: isBookmarked ? 'var(--gold-light)' : 'rgba(255,255,255,0.55)',
              fontSize: '12px',
              fontFamily: 'DM Sans',
              cursor: isBookmarked ? 'default' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!isBookmarked) {
                e.currentTarget.style.background = 'rgba(196,154,60,0.12)'
                e.currentTarget.style.borderColor = 'rgba(196,154,60,0.35)'
                e.currentTarget.style.color = 'var(--gold-light)'
              }
            }}
            onMouseLeave={(e) => {
              if (!isBookmarked) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
                e.currentTarget.style.color = 'rgba(255,255,255,0.55)'
              }
            }}
          >
            {isBookmarked
              ? <><HeartHandshake size={13} /> 已收藏</>
              : <><Heart size={13} /> 收藏</>}
          </button>
        </div>
      </div>
    </div>
  )
}
