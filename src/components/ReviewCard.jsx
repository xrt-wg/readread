import { useEffect, useRef } from 'react'
import { Volume2 } from 'lucide-react'
import { highlightWord } from '../utils/textUtils'
import { TYPE_DOT, TYPE_LABEL, formatDate } from '../utils/reviewUtils'

const CARD_BG = '#fdfaf5'
const CARD_RADIUS = '24px'
const CARD_SHADOW = '0 2px 16px rgba(28,25,23,0.06), 0 1px 4px rgba(28,25,23,0.04)'
const CARD_BORDER = '1px solid rgba(28,25,23,0.06)'

/**
 * 卡片正面 — 仅内容
 */
function CardFront({ bookmark, onSpeak, isSupported, speechError }) {
  const isShort = bookmark.type === 'word' || bookmark.type === 'phrase'

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-10 gap-6">
      {isSupported && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); onSpeak(bookmark.text) }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 transition-all"
            style={{
              background: 'transparent',
              border: '1px solid rgba(28,25,23,0.12)',
              cursor: 'pointer',
              color: 'var(--ink-muted)',
              fontSize: '12px',
              fontFamily: 'DM Sans',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(28,25,23,0.05)'; e.currentTarget.style.color = 'var(--ink)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}
          >
            <Volume2 size={13} />发音
          </button>
          {speechError && (
            <p style={{ fontSize: '11px', fontFamily: 'DM Sans', color: '#dc2626', opacity: 0.8, maxWidth: '280px', textAlign: 'center', lineHeight: 1.45 }}>{speechError}</p>
          )}
        </>
      )}

      {isShort ? (
        <div className="flex flex-col items-center gap-5 w-full">
          <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 'clamp(28px, 5vw, 42px)', fontWeight: 700, color: 'var(--ink)', textAlign: 'center', lineHeight: 1.2, letterSpacing: '-0.01em' }}>{bookmark.text}</p>
          {bookmark.contextSentence && (() => {
            const { before, match, after } = highlightWord(bookmark.contextSentence, bookmark.text)
            return (
              <p style={{ fontFamily: '"Lora", Georgia, serif', fontSize: '15px', fontStyle: 'italic', color: 'var(--ink-light)', lineHeight: 1.7, textAlign: 'center', maxWidth: '440px' }}>
                {before}{match && <strong style={{ color: 'var(--ink)', fontStyle: 'italic', fontWeight: 700 }}>{match}</strong>}{after}
              </p>
            )
          })()}
        </div>
      ) : (
        <p style={{ fontFamily: '"Lora", Georgia, serif', fontSize: 'clamp(16px, 2.2vw, 20px)', fontStyle: 'italic', color: 'var(--ink)', lineHeight: 1.75, textAlign: 'center', maxWidth: '480px' }}>{bookmark.text}</p>
      )}
    </div>
  )
}

/**
 * 卡片背面 — 三角落布局 + 来源
 */
function CardBack({ bookmark }) {
  return (
    <div className="flex flex-col justify-center h-full gap-3">
      {/* 左上：类型 · 右上：日期 */}
      <div
        className="flex items-center gap-2"
        style={{ position: 'absolute', top: '36px', left: '28px', right: '28px' }}
      >
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: TYPE_DOT[bookmark.type] ?? '#fbbf24', flexShrink: 0 }} />
        <span style={{ fontSize: '10px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', letterSpacing: '0.07em', textTransform: 'uppercase', fontWeight: 500 }}>{TYPE_LABEL[bookmark.type] ?? '收藏'}</span>
        <span style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.45, marginLeft: 'auto' }}>{formatDate(bookmark.createdAt)}</span>
      </div>

      {/* 左下：文章来源 */}
      {bookmark.articleTitle && (
        <div style={{ position: 'absolute', bottom: '36px', left: '28px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.45 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          来自《{bookmark.articleTitle}》
        </div>
      )}

      {/* 主体内容 */}
      <p style={{ fontFamily: '"Lora", Georgia, serif', fontSize: '14px', fontStyle: 'italic', color: 'var(--ink-muted)', lineHeight: 1.4 }}>{bookmark.text}</p>
      {bookmark.translation && (
        <p style={{ fontFamily: 'DM Sans', fontSize: 'clamp(20px, 3.5vw, 28px)', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.25 }}>{bookmark.translation}</p>
      )}
      {bookmark.contextSentence && (() => {
        const { before, match, after } = highlightWord(bookmark.contextSentence, bookmark.text)
        return (
          <p style={{ fontFamily: '"Lora", Georgia, serif', fontSize: '13px', fontStyle: 'italic', color: 'var(--ink-light)', lineHeight: 1.6, marginTop: '4px' }}>
            {before}{match && <strong style={{ color: 'var(--ink)', fontStyle: 'italic', fontWeight: 700 }}>{match}</strong>}{after}
          </p>
        )
      })()}
      {bookmark.contextTranslation && (
        <p style={{ fontFamily: 'DM Sans', fontSize: '12px', color: 'var(--ink-muted)', lineHeight: 1.55, opacity: 0.75 }}>{bookmark.contextTranslation}</p>
      )}
    </div>
  )
}

/**
 * ReviewCard — 回顾闪卡
 *
 * 结构：
 *   slide wrapper → 卡片容器 → ┌ flip 区（3D 翻面）
 *                              └ footer（计数器 + 反馈按钮，常驻不翻转）
 */
export default function ReviewCard({
  bookmark, flipped, onFlip,
  slideState, onSlideExit, onSlideEnter,
  counter, progressPct, onFeedback, feedbackDisabled,
  onSpeak, isSpeechSupported, speechError,
}) {
  const slideRef = useRef(null)

  // ─── 滑动动画 ───
  useEffect(() => {
    const el = slideRef.current
    if (!el) return

    if (slideState === 'exiting') {
      el.style.transition = 'transform 0.25s ease, opacity 0.2s ease'
      el.style.transform = 'translateX(-24px)'
      el.style.opacity = '0'
      const onEnd = (e) => {
        if (e.target === el) {
          el.removeEventListener('transitionend', onEnd)
          onSlideExit?.()
        }
      }
      el.addEventListener('transitionend', onEnd)
      return () => el.removeEventListener('transitionend', onEnd)
    }

    if (slideState === 'entering') {
      el.style.transition = 'none'
      el.style.transform = 'translateX(24px)'
      el.style.opacity = '0'
      // eslint-disable-next-line no-unused-expressions
      el.offsetHeight
      el.style.transition = 'transform 0.25s ease, opacity 0.2s ease'
      el.style.transform = 'translateX(0)'
      el.style.opacity = '1'
      const onEnd = (e) => {
        if (e.target === el) {
          el.removeEventListener('transitionend', onEnd)
          onSlideEnter?.()
        }
      }
      el.addEventListener('transitionend', onEnd)
      return () => el.removeEventListener('transitionend', onEnd)
    }
  }, [slideState, onSlideExit, onSlideEnter])

  // ─── face 共用底（透明，卡片视觉由外层容器负责）───
  const faceBase = {
    position: 'absolute',
    inset: 0,
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  }

  return (
    <div ref={slideRef}>
      {/* 卡片容器：背景/圆角/阴影统一在此 */}
      <div style={{
        background: CARD_BG,
        borderRadius: CARD_RADIUS,
        boxShadow: CARD_SHADOW,
        border: CARD_BORDER,
        overflow: 'hidden',
      }}>
        {/* ── 顶部进度条 ── */}
        <div style={{ padding: '22px 190px 0' }}>
          <div style={{ height: '4px', background: 'rgba(28,25,23,0.07)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progressPct}%`, background: 'linear-gradient(90deg, var(--gold), var(--gold-light))', borderRadius: '2px', transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }} />
          </div>
        </div>

        {/* ── Flip 区 ── */}
        <div style={{ perspective: '800px' }}>
          <div
            onClick={onFlip}
            style={{
              position: 'relative',
              minHeight: '320px',
              transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
              transformStyle: 'preserve-3d',
              transform: flipped ? 'rotateY(180deg)' : 'none',
              cursor: 'pointer',
            }}
          >
            {/* 正面 */}
            <div style={faceBase}>
              <CardFront bookmark={bookmark} onSpeak={onSpeak} isSupported={isSpeechSupported} speechError={speechError} />
            </div>

            {/* 背面 */}
            <div style={{ ...faceBase, alignItems: 'stretch', padding: '0 28px', transform: 'rotateY(180deg)' }}>
              <CardBack bookmark={bookmark} />
            </div>
          </div>
        </div>

        {/* ── Footer：计数器(左) + 反馈按钮(右)，常驻 ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 28px 14px',
        }}>
          {/* 左下：进度计数 */}
          <span style={{
            fontSize: '12px',
            fontFamily: 'DM Sans',
            fontWeight: 500,
            color: 'var(--ink-muted)',
            letterSpacing: '0.03em',
            lineHeight: '37px',  // 匹配按钮高度
          }}>{counter}</span>

          {/* 右下：反馈按钮 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={(e) => { e.stopPropagation(); onFeedback('hard') }}
              disabled={feedbackDisabled}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 transition-all"
              style={{
                background: 'transparent',
                border: '1px solid rgba(220,38,38,0.2)',
                cursor: feedbackDisabled ? 'default' : 'pointer',
                color: '#dc2626',
                fontSize: '13px',
                fontFamily: 'DM Sans',
                fontWeight: 400,
                opacity: feedbackDisabled ? 0.5 : 1,
                lineHeight: 1,
              }}
              onMouseEnter={(e) => { if (!feedbackDisabled) { e.currentTarget.style.background = 'rgba(220,38,38,0.05)'; e.currentTarget.style.borderColor = 'rgba(220,38,38,0.35)' } }}
              onMouseLeave={(e) => { if (!feedbackDisabled) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(220,38,38,0.2)' } }}
            >
              生疏
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onFeedback('ok') }}
              disabled={feedbackDisabled}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 transition-all"
              style={{
                background: 'rgba(245,158,11,0.10)',
                border: '1px solid rgba(180,83,9,0.18)',
                cursor: feedbackDisabled ? 'default' : 'pointer',
                color: '#b45309',
                fontSize: '13px',
                fontFamily: 'DM Sans',
                fontWeight: 500,
                opacity: feedbackDisabled ? 0.5 : 1,
                lineHeight: 1,
              }}
              onMouseEnter={(e) => { if (!feedbackDisabled) e.currentTarget.style.background = 'rgba(245,158,11,0.18)' }}
              onMouseLeave={(e) => { if (!feedbackDisabled) e.currentTarget.style.background = 'rgba(245,158,11,0.10)' }}
            >
              一般
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onFeedback('easy') }}
              disabled={feedbackDisabled}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 transition-all"
              style={{
                background: '#16a34a',
                border: 'none',
                cursor: feedbackDisabled ? 'default' : 'pointer',
                color: '#fff',
                fontSize: '13px',
                fontFamily: 'DM Sans',
                fontWeight: 600,
                opacity: feedbackDisabled ? 0.5 : 1,
                boxShadow: '0 1px 3px rgba(22,163,74,0.25)',
                lineHeight: 1,
              }}
              onMouseEnter={(e) => { if (!feedbackDisabled) { e.currentTarget.style.background = '#15803d'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(22,163,74,0.3)' } }}
              onMouseLeave={(e) => { if (!feedbackDisabled) { e.currentTarget.style.background = '#16a34a'; e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 3px rgba(22,163,74,0.25)' } }}
            >
              熟练
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
