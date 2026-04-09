import { useState, useEffect, useCallback } from 'react'
import { X, Volume2, ChevronRight, RotateCcw } from 'lucide-react'
import { useSpeech } from '../hooks/useSpeech'
import { highlightWord } from '../utils/textUtils'
import { bookmarkStore } from '../store/storage'

const TYPE_DOT = {
  word: '#fbbf24',
  phrase: '#34d399',
  sentence: '#818cf8',
  paragraph: '#818cf8',
}

const TYPE_LABEL = { word: '词', phrase: '句', sentence: '句', paragraph: '段' }

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function shuffleArray(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function CardFront({ bookmark, onSpeak, isSupported, speechError }) {
  const isShort = bookmark.type === 'word' || bookmark.type === 'phrase'

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-10 gap-6">
      {/* 发音按钮 */}
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
            <Volume2 size={13} />
            发音
          </button>
          {speechError && (
            <p
              style={{
                fontSize: '11px',
                fontFamily: 'DM Sans',
                color: '#dc2626',
                opacity: 0.8,
                maxWidth: '280px',
                textAlign: 'center',
                lineHeight: 1.45,
              }}
            >
              {speechError}
            </p>
          )}
        </>
      )}

      {/* 正面主内容 */}
      {isShort ? (
        <div className="flex flex-col items-center gap-5 w-full">
          {/* 词 / 短句 */}
          <p
            style={{
              fontFamily: '"Playfair Display", Georgia, serif',
              fontSize: 'clamp(28px, 5vw, 42px)',
              fontWeight: 700,
              color: 'var(--ink)',
              textAlign: 'center',
              lineHeight: 1.2,
              letterSpacing: '-0.01em',
            }}
          >
            {bookmark.text}
          </p>

          {/* 原文例句（有 contextSentence 时显示） */}
          {bookmark.contextSentence && (() => {
            const { before, match, after } = highlightWord(bookmark.contextSentence, bookmark.text)
            return (
              <p
                style={{
                  fontFamily: '"Lora", Georgia, serif',
                  fontSize: '14px',
                  fontStyle: 'italic',
                  color: 'var(--ink-light)',
                  lineHeight: 1.7,
                  textAlign: 'center',
                  maxWidth: '440px',
                }}
              >
                {before}
                {match && (
                  <strong style={{ color: 'var(--ink)', fontStyle: 'italic', fontWeight: 700 }}>
                    {match}
                  </strong>
                )}
                {after}
              </p>
            )
          })()}
        </div>
      ) : (
        /* 句子 / 段落：直接显示 text */
        <p
          style={{
            fontFamily: '"Lora", Georgia, serif',
            fontSize: 'clamp(16px, 2.2vw, 20px)',
            fontStyle: 'italic',
            color: 'var(--ink)',
            lineHeight: 1.75,
            textAlign: 'center',
            maxWidth: '480px',
          }}
        >
          {bookmark.text}
        </p>
      )}

      {/* 提示 */}
      <p
        style={{
          fontSize: '12px',
          fontFamily: 'DM Sans',
          color: 'var(--ink-muted)',
          opacity: 0.45,
          marginTop: '8px',
        }}
      >
        点击卡片查看翻译
      </p>
    </div>
  )
}

function CardBack({ bookmark }) {
  return (
    <div className="flex flex-col justify-center h-full px-8 py-10 gap-3">
      {/* Type badge + date */}
      <div className="flex items-center gap-2 mb-1">
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: TYPE_DOT[bookmark.type] ?? '#fbbf24',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: '10px',
            fontFamily: 'DM Sans',
            color: 'var(--ink-muted)',
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}
        >
          {TYPE_LABEL[bookmark.type] ?? '收藏'}
        </span>
        <span
          style={{
            fontSize: '11px',
            fontFamily: 'DM Sans',
            color: 'var(--ink-muted)',
            opacity: 0.45,
            marginLeft: 'auto',
          }}
        >
          {formatDate(bookmark.createdAt)}
        </span>
      </div>

      {/* 原词（斜体小字） */}
      <p
        style={{
          fontFamily: '"Lora", Georgia, serif',
          fontSize: '13px',
          fontStyle: 'italic',
          color: 'var(--ink-muted)',
          lineHeight: 1.4,
        }}
      >
        {bookmark.text}
      </p>

      {/* 翻译（主，大字） */}
      {bookmark.translation && (
        <p
          style={{
            fontFamily: 'DM Sans',
            fontSize: 'clamp(20px, 3.5vw, 28px)',
            fontWeight: 700,
            color: 'var(--ink)',
            lineHeight: 1.25,
          }}
        >
          {bookmark.translation}
        </p>
      )}

      {/* 语境句原文 */}
      {bookmark.contextSentence && (() => {
        const { before, match, after } = highlightWord(bookmark.contextSentence, bookmark.text)
        return (
          <p
            style={{
              fontFamily: '"Lora", Georgia, serif',
              fontSize: '13px',
              fontStyle: 'italic',
              color: 'var(--ink-light)',
              lineHeight: 1.6,
              marginTop: '4px',
            }}
          >
            {before}
            {match && (
              <strong style={{ color: 'var(--ink)', fontStyle: 'italic', fontWeight: 700 }}>
                {match}
              </strong>
            )}
            {after}
          </p>
        )
      })()}

      {/* 语境句译文 */}
      {bookmark.contextTranslation && (
        <p
          style={{
            fontFamily: 'DM Sans',
            fontSize: '12px',
            color: 'var(--ink-muted)',
            lineHeight: 1.55,
            opacity: 0.75,
          }}
        >
          {bookmark.contextTranslation}
        </p>
      )}
    </div>
  )
}

export default function ReviewModal({ open, onClose }) {
  const [cards, setCards] = useState([])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [finished, setFinished] = useState(false)
  const { speak, stop, isSupported, error: speechError } = useSpeech()

  useEffect(() => {
    if (!open) return
    const all = bookmarkStore.getAll()
    const shuffled = shuffleArray(all).slice(0, 10)
    setCards(shuffled)
    setIndex(0)
    setFlipped(false)
    setFinished(false)
  }, [open])

  useEffect(() => {
    if (!open) stop()
  }, [open, stop])

  const handleFlip = useCallback(() => {
    setFlipped((f) => !f)
  }, [])

  const handleNext = useCallback(() => {
    stop()
    if (index + 1 >= cards.length) {
      setFinished(true)
    } else {
      setIndex((i) => i + 1)
      setFlipped(false)
    }
  }, [index, cards.length, stop])

  const handleRestart = useCallback(() => {
    const all = bookmarkStore.getAll()
    const shuffled = shuffleArray(all).slice(0, 10)
    setCards(shuffled)
    setIndex(0)
    setFlipped(false)
    setFinished(false)
  }, [])

  const handleClose = useCallback(() => {
    stop()
    onClose()
  }, [stop, onClose])

  if (!open) return null

  const current = cards[index]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(28,25,23,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div
        className="relative flex flex-col"
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '90vh',
          margin: '0 16px',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <span
            style={{
              fontFamily: '"Playfair Display", Georgia, serif',
              fontSize: '15px',
              fontWeight: 600,
              color: '#fff',
              opacity: 0.9,
            }}
          >
            回顾
          </span>
          {!finished && cards.length > 0 && (
            <span
              style={{
                fontFamily: 'DM Sans',
                fontSize: '13px',
                color: 'rgba(255,255,255,0.55)',
              }}
            >
              {index + 1} / {cards.length}
            </span>
          )}
          <button
            onClick={handleClose}
            className="flex items-center justify-center rounded-xl transition-all"
            style={{
              width: 32,
              height: 32,
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.7)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          >
            <X size={15} />
          </button>
        </div>

        {/* Progress bar */}
        {!finished && cards.length > 0 && (
          <div
            style={{
              height: '3px',
              background: 'rgba(255,255,255,0.12)',
              borderRadius: '2px',
              marginBottom: '16px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${((index + 1) / cards.length) * 100}%`,
                background: 'var(--gold)',
                borderRadius: '2px',
                transition: 'width 0.35s ease',
              }}
            />
          </div>
        )}

        {/* Card */}
        <div
          onClick={!finished && cards.length > 0 ? handleFlip : undefined}
          style={{
            background: '#fdfaf5',
            borderRadius: '24px',
            minHeight: '360px',
            cursor: (!finished && cards.length > 0) ? 'pointer' : 'default',
            boxShadow: '0 12px 48px rgba(28,25,23,0.22)',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* 空状态 */}
          {cards.length === 0 && (
            <div
              className="flex flex-col items-center justify-center h-full gap-3"
              style={{ minHeight: '360px', padding: '48px 32px' }}
            >
              <p
                style={{
                  fontFamily: '"Playfair Display", Georgia, serif',
                  fontSize: '18px',
                  fontWeight: 600,
                  color: 'var(--ink)',
                  textAlign: 'center',
                  lineHeight: 1.5,
                }}
              >
                你当前没有可回顾的内容
              </p>
              <p
                style={{
                  fontFamily: 'DM Sans',
                  fontSize: '13px',
                  color: 'var(--ink-muted)',
                  textAlign: 'center',
                  lineHeight: 1.6,
                  opacity: 0.7,
                }}
              >
                阅读文章时，划选词句并收藏
                <br />
                即可在这里回顾
              </p>
            </div>
          )}

          {/* 完成状态 */}
          {finished && (
            <div
              className="flex flex-col items-center justify-center gap-4"
              style={{ minHeight: '360px', padding: '48px 32px' }}
            >
              <p
                style={{
                  fontFamily: '"Playfair Display", Georgia, serif',
                  fontSize: '22px',
                  fontWeight: 700,
                  color: 'var(--ink)',
                }}
              >
                回顾完成 ✓
              </p>
              <p
                style={{
                  fontFamily: 'DM Sans',
                  fontSize: '13px',
                  color: 'var(--ink-muted)',
                  opacity: 0.7,
                }}
              >
                共回顾了 {cards.length} 条收藏
              </p>
              <button
                onClick={handleRestart}
                className="flex items-center gap-2 rounded-xl transition-all"
                style={{
                  marginTop: '8px',
                  background: 'var(--ink)',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 22px',
                  fontSize: '13px',
                  fontFamily: 'DM Sans',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#2d2926')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--ink)')}
              >
                <RotateCcw size={13} />
                再来一轮
              </button>
            </div>
          )}

          {/* 正/反面 */}
          {!finished && current && (
            flipped
              ? <CardBack bookmark={current} />
              : <CardFront bookmark={current} onSpeak={speak} isSupported={isSupported} speechError={speechError} />
          )}
        </div>

        {/* Controls */}
        {!finished && cards.length > 0 && (
          <div className="flex items-center justify-between mt-4 px-1">
            <button
              onClick={handleFlip}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 transition-all"
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                cursor: 'pointer',
                color: 'rgba(255,255,255,0.75)',
                fontSize: '13px',
                fontFamily: 'DM Sans',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            >
              {flipped ? '看正面' : '看翻译'}
            </button>

            <button
              onClick={handleNext}
              className="flex items-center gap-1.5 rounded-xl px-5 py-2 transition-all"
              style={{
                background: 'var(--gold)',
                border: 'none',
                cursor: 'pointer',
                color: '#fff',
                fontSize: '13px',
                fontFamily: 'DM Sans',
                fontWeight: 600,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.88')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              {index + 1 >= cards.length ? '完成' : '下一张'}
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
