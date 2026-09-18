import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, Loader2, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { chooseFirstReading, dismissFirstReading, dismissedThisSession, getFirstReadingOffer } from '../services/firstReading'
import { isLibraryAccessError } from '../services/errorUtils'
import { readTrialSnapshot } from '../services/migration/firstReadingMigration'

export default function FirstReadingChoiceModal({ ready, onOpen, onChanged, onNotice }) {
  const { userId, isAuthenticated, refreshAuthState } = useAuth()
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const dialog = useRef(null)
  const closeButton = useRef(null)
  const alive = useRef(true)
  const running = useRef(false)
  const open = items.length === 2
  const handlers = useRef({})

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    if (!ready || !isAuthenticated || !userId || dismissedThisSession.has(userId)) return
    let active = true
    Promise.resolve().then(async () => {
      if (!active) return
      try {
        if (!readTrialSnapshot(window.localStorage).empty) return
        const offer = await getFirstReadingOffer()
        if (active && offer?.status === 'pending' && offer.items?.length === 2) setItems(offer.items)
      } catch (failure) {
        if (active && isLibraryAccessError(failure)) refreshAuthState()
        // Disabled/missing migration, corrupt local data or transient failure never blocks the homepage.
      }
    })
    return () => { active = false }
  }, [ready, isAuthenticated, userId, refreshAuthState])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    const root = document.getElementById('root')
    const previousInert = root?.inert
    const previousOverflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); handlers.current.close() }
      if (event.key !== 'Tab') return
      const targets = [...dialog.current.querySelectorAll('button:not(:disabled)')]
      if (!targets.length) { event.preventDefault(); dialog.current.focus(); return }
      const first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && (document.activeElement === first || !targets.includes(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !targets.includes(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      if (root) root.inert = previousInert
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])

  async function close() {
    if (running.current) return
    dismissedThisSession.add(userId)
    setItems([])
    // Retry once, but never pretend a local dismissal is cross-device persistence.
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await dismissFirstReading(); if (alive.current) onChanged(); return } catch (failure) {
        if (!alive.current) return
        if (isLibraryAccessError(failure)) { refreshAuthState(); break }
      }
    }
    if (alive.current) onNotice('关闭状态未能同步，本次不会再次显示')
  }
  handlers.current.close = close

  async function choose(id) {
    if (running.current) return
    running.current = true
    setBusy(true); setSelected(id); setError('')
    try {
      const result = await chooseFirstReading(id)
      if (!alive.current) return
      if (result.status !== 'chosen' || !result.readingId) { setItems([]); onChanged(); return }
      const opened = await onOpen({ id: result.readingId })
      if (!alive.current) return
      setItems([]); onChanged()
      if (!opened) onNotice('这篇内容当前不可用')
    } catch (failure) {
      if (!alive.current) return
      if (isLibraryAccessError(failure)) {
        setItems([]); refreshAuthState(); onNotice('账号状态已变化，请重新登录后继续')
      } else if (failure.message?.includes('正文')) {
        setItems([]); onNotice('文章正文暂不可用'); onChanged()
      } else if (failure.message?.includes('选文内容暂不可用')) {
        setItems([]); onNotice('选文内容暂不可用，可以从书架开始阅读')
      } else {
        setError('暂时未能打开，请重试')
      }
    } finally {
      running.current = false
      if (alive.current) setBusy(false)
    }
  }

  if (!open) return null
  return createPortal(
    <div className="first-reading-backdrop">
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="first-reading-title" aria-busy={busy} tabIndex={-1} className="first-reading-dialog">
        <button ref={closeButton} type="button" className="first-reading-close" onClick={close} disabled={busy} aria-label="关闭选文弹窗"><X size={20} /></button>
        <h2 id="first-reading-title">挑一篇开始吧</h2>
        <div className="first-reading-grid">
          {items.map(item => (
            <button type="button" key={item.id} className="first-reading-card" disabled={busy || Boolean(selected && selected !== item.id)} onClick={() => choose(item.id)}>
              <span className="first-reading-card-title">{item.title}</span>
              <span className="first-reading-intro">{item.intro}</span>
              <span className="first-reading-card-footer"><span>{item.wordCount.toLocaleString()} 词</span>
                {busy && selected === item.id ? <Loader2 size={19} className="animate-spin" aria-label="正在打开" /> : <ArrowUpRight size={20} />}
              </span>
            </button>
          ))}
        </div>
        {error && <div className="first-reading-error" role="alert">{error} <button onClick={() => choose(selected)} disabled={busy}>重新打开</button></div>}
      </section>
    </div>, document.body,
  )
}
