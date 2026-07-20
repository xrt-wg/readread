import { useState, useEffect, useCallback } from 'react'
import { X, ChevronRight, RotateCcw } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useSpeech } from '../hooks/useSpeech'
import { isLibraryAccessError, resolveLibraryErrorMessage } from '../services/errorUtils'
import { listAllBookmarks } from '../services/library'
import { shuffleArray } from '../utils/reviewUtils'
import ReviewCard from './ReviewCard'
export default function ReviewModal({ open, onClose }) {
  const { canUseCloudLibrary, refreshAuthState, userId } = useAuth()
  const [cards, setCards] = useState([])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [finished, setFinished] = useState(false)
  const [loadError, setLoadError] = useState('')
  const { speak, stop, isSupported, error: speechError } = useSpeech()

  useEffect(() => {
    if (!open) return undefined

    let isActive = true

    async function initializeCards() {
      try {
        setLoadError('')

        const all = await listAllBookmarks({
          canUseCloudLibrary,
          userId,
        })
        const shuffled = shuffleArray(all).slice(0, 10)

        if (!isActive) {
          return
        }

        setCards(shuffled)
        setIndex(0)
        setFlipped(false)
        setFinished(false)
      } catch (bookmarkLoadError) {
        if (!isActive) {
          return
        }

        if (isLibraryAccessError(bookmarkLoadError)) {
          refreshAuthState()
        }

        setCards([])
        setLoadError(resolveLibraryErrorMessage(bookmarkLoadError, '加载回顾内容失败，请稍后重试'))
      }
    }

    initializeCards()

    return () => {
      isActive = false
    }
  }, [open, canUseCloudLibrary, refreshAuthState, userId])

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

  const handleRestart = useCallback(async () => {
    try {
      setLoadError('')

      const all = await listAllBookmarks({
        canUseCloudLibrary,
        userId,
      })
      const shuffled = shuffleArray(all).slice(0, 10)
      setCards(shuffled)
      setIndex(0)
      setFlipped(false)
      setFinished(false)
    } catch (bookmarkLoadError) {
      if (isLibraryAccessError(bookmarkLoadError)) {
        refreshAuthState()
      }

      setCards([])
      setLoadError(resolveLibraryErrorMessage(bookmarkLoadError, '加载回顾内容失败，请稍后重试'))
    }
  }, [canUseCloudLibrary, refreshAuthState, userId])

  const handleClose = useCallback(() => {
    stop()
    onClose()
  }, [stop, onClose])

  if (!open) return null

  const current = cards[index]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(6px)' }}
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
          {loadError ? (
            <span className="max-w-[320px] text-right text-xs text-amber-100">{loadError}</span>
          ) : null}
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
            background: 'var(--card-bg-warm)',
            borderRadius: '24px',
            minHeight: '360px',
            cursor: (!finished && cards.length > 0) ? 'pointer' : 'default',
            boxShadow: 'var(--popup-shadow)',
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
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--btn-hover-bg)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--ink)')}
              >
                <RotateCcw size={13} />
                再来一轮
              </button>
            </div>
          )}

          {/* 正/反面 — ReviewCard 自行管理翻面 */}
          {!finished && current && (
            <ReviewCard bookmark={current} flipped={flipped} onFlip={handleFlip} onSpeak={speak} isSpeechSupported={isSupported} speechError={speechError} />
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
