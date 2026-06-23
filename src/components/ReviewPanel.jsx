import { useState, useEffect, useCallback, useRef } from 'react'
import { RotateCcw } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useSpeech } from '../hooks/useSpeech'
import { isLibraryAccessError, resolveLibraryErrorMessage } from '../services/errorUtils'
import { listDueBookmarks, saveBookmark, listAllBookmarks } from '../services/library'
import { computeNextReview, computeReviewStats } from '../utils/reviewUtils'
import ReviewCard from './ReviewCard'

export default function ReviewPanel() {
  const { canUseCloudLibrary, refreshAuthState, userId } = useAuth()
  const [cards, setCards] = useState([])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [finished, setFinished] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState(null)
  const [sessionStats, setSessionStats] = useState({ easy: 0, ok: 0, hard: 0 })
  const [slideState, setSlideState] = useState('idle')  // 'idle' | 'exiting' | 'entering'
  const reviewedThisSession = useRef(new Set())
  const { speak, stop, isSupported, error: speechError } = useSpeech()

  useEffect(() => {
    let isActive = true
    async function init() {
      try {
        setLoadError('')
        const session = await listDueBookmarks({ canUseCloudLibrary, userId })
        if (!isActive) return
        setCards(session)
        setIndex(0)
        setFlipped(false)
        setFinished(false)
        setSessionStats({ easy: 0, ok: 0, hard: 0 })
        setSlideState('idle')
        reviewedThisSession.current.clear()
        const all = await listAllBookmarks({ canUseCloudLibrary, userId })
        setStats(computeReviewStats(all))
      } catch (e) {
        if (!isActive) return
        if (isLibraryAccessError(e)) refreshAuthState()
        setCards([])
        setStats(null)
        setLoadError(resolveLibraryErrorMessage(e, '加载回顾内容失败，请稍后重试'))
      }
    }
    init()
    return () => { isActive = false }
  }, [canUseCloudLibrary, userId])

  const handleFlip = useCallback(() => {
    if (slideState !== 'idle') return
    setFlipped((f) => !f)
  }, [slideState])

  const advanceToNext = useCallback(() => {
    if (index + 1 >= cards.length) {
      setFinished(true)
    } else {
      setIndex((i) => i + 1)
      setFlipped(false)
    }
  }, [index, cards.length])

  const handleFeedback = useCallback(async (feedback) => {
    if (saving || slideState !== 'idle') return
    const bookmark = cards[index]
    if (!bookmark) return

    stop()
    setSaving(true)
    setSlideState('exiting')
    reviewedThisSession.current.add(bookmark.id)

    // 记录本轮统计
    setSessionStats((prev) => ({ ...prev, [feedback]: prev[feedback] + 1 }))

    try {
      const updated = computeNextReview(bookmark, feedback)
      await saveBookmark({ ...bookmark, ...updated }, { canUseCloudLibrary, userId })
    } catch (e) {
      if (isLibraryAccessError(e)) refreshAuthState()
      setLoadError(resolveLibraryErrorMessage(e, '保存复习进度失败，请稍后重试'))
    }
    // 保存完成后等待 exiting 动画结束 → handleSlideExit 中 advanceToNext
  }, [cards, index, saving, slideState, canUseCloudLibrary, refreshAuthState, userId, stop])

  // exiting 动画结束后：切数据 + 触发 entering 动画
  const handleSlideExit = useCallback(() => {
    setSaving(false)
    advanceToNext()
    setSlideState('entering')
  }, [advanceToNext])

  // entering 动画结束后：恢复 idle
  const handleSlideEnter = useCallback(() => {
    setSlideState('idle')
  }, [])

  const handleRestart = useCallback(async () => {
    try {
      stop()
      setLoadError('')
      const session = await listDueBookmarks(
        { canUseCloudLibrary, userId },
        reviewedThisSession.current
      )
      setCards(session)
      setIndex(0)
      setFlipped(false)
      setFinished(false)
      setSessionStats({ easy: 0, ok: 0, hard: 0 })
      setSlideState('idle')
      reviewedThisSession.current.clear()
      const all = await listAllBookmarks({ canUseCloudLibrary, userId })
      setStats(computeReviewStats(all))
    } catch (e) {
      if (isLibraryAccessError(e)) refreshAuthState()
      setCards([])
      setStats(null)
      setLoadError(resolveLibraryErrorMessage(e, '加载回顾内容失败，请稍后重试'))
    }
  }, [canUseCloudLibrary, refreshAuthState, userId, stop])

  const current = cards[index]

  return (
    <div className="w-full" style={{ maxWidth: '560px', margin: '0 auto' }}>
      {/* Stats row — 保持不变 */}
      {stats && (
        <div className="flex gap-3 mb-5">
          {[
            { label: '待复习', value: stats.due, unit: '张' },
            { label: '已掌握', value: stats.mastered, unit: '' },
            { label: '总收藏', value: stats.total, unit: '张' },
          ].map(({ label, value, unit }) => (
            <div key={label} style={{ flex: 1, background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(28,25,23,0.07)', borderRadius: '14px', padding: '12px 16px', textAlign: 'center' }}>
              <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '20px', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1 }}>
                {value}<span style={{ fontSize: '12px', fontWeight: 400, marginLeft: '3px', color: 'var(--ink-muted)' }}>{unit}</span>
              </div>
              <div style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', marginTop: '5px', letterSpacing: '0.04em' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {loadError && (
        <div className="mb-5" style={{ fontSize: '12px', fontFamily: 'DM Sans', color: '#b91c1c', textAlign: 'center' }}>{loadError}</div>
      )}

      {/* Card area */}
      <div
        style={{
          background: cards.length === 0 || finished ? '#fdfaf5' : undefined,
          borderRadius: '24px',
          minHeight: '360px',
          boxShadow: (!finished && cards.length > 0) ? undefined : '0 2px 16px rgba(28,25,23,0.06), 0 1px 4px rgba(28,25,23,0.04)',
          border: (!finished && cards.length > 0) ? undefined : '1px solid rgba(28,25,23,0.06)',
          overflow: 'hidden',
        }}
      >
        {/* 空状态 */}
        {cards.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3" style={{ minHeight: '360px', padding: '48px 32px' }}>
            <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '18px', fontWeight: 600, color: 'var(--ink)', textAlign: 'center', lineHeight: 1.5 }}>你当前没有可回顾的内容</p>
            <p style={{ fontFamily: 'DM Sans', fontSize: '13px', color: 'var(--ink-muted)', textAlign: 'center', lineHeight: 1.6, opacity: 0.7 }}>阅读文章时，划选词句并收藏<br />即可在这里回顾</p>
          </div>
        )}

        {/* 完成状态 */}
        {finished && (
          <div className="flex flex-col items-center justify-center gap-3" style={{ minHeight: '360px', padding: '48px 32px' }}>
            <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '22px', fontWeight: 700, color: 'var(--ink)' }}>回顾完成 ✓</p>

            {/* 本轮统计 */}
            <div className="flex gap-4" style={{ margin: '4px 0 4px' }}>
              <div style={{ textAlign: 'center', minWidth: '52px' }}>
                <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '22px', fontWeight: 700, lineHeight: 1.1, color: '#16a34a' }}>{sessionStats.easy}</div>
                <div style={{ fontSize: '10px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', letterSpacing: '0.05em', marginTop: '3px' }}>熟练</div>
              </div>
              <div style={{ textAlign: 'center', minWidth: '52px' }}>
                <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '22px', fontWeight: 700, lineHeight: 1.1, color: '#b45309' }}>{sessionStats.ok}</div>
                <div style={{ fontSize: '10px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', letterSpacing: '0.05em', marginTop: '3px' }}>一般</div>
              </div>
              <div style={{ textAlign: 'center', minWidth: '52px' }}>
                <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '22px', fontWeight: 700, lineHeight: 1.1, color: '#dc2626' }}>{sessionStats.hard}</div>
                <div style={{ fontSize: '10px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', letterSpacing: '0.05em', marginTop: '3px' }}>生疏</div>
              </div>
            </div>

            <p style={{ fontSize: '13px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.65, marginBottom: '4px' }}>共回顾 {cards.length} 条收藏</p>
            <button onClick={handleRestart} className="flex items-center gap-2 rounded-xl transition-all" style={{ marginTop: '4px', background: 'var(--ink)', color: '#fff', border: 'none', padding: '10px 22px', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, cursor: 'pointer' }} onMouseEnter={(e) => (e.currentTarget.style.background = '#2d2926')} onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--ink)')}><RotateCcw size={13} />再来一轮</button>
          </div>
        )}

        {/* 卡片 */}
        {!finished && current && (
          <ReviewCard
            key={index}
            bookmark={current}
            flipped={flipped}
            onFlip={handleFlip}
            slideState={slideState}
            onSlideExit={handleSlideExit}
            onSlideEnter={handleSlideEnter}
            counter={`${index + 1} / ${cards.length}`}
            progressPct={((index + 1) / cards.length) * 100}
            onFeedback={handleFeedback}
            feedbackDisabled={saving || slideState !== 'idle'}
            onSpeak={speak}
            isSpeechSupported={isSupported}
            speechError={speechError}
          />
        )}
      </div>

    </div>
  )
}
