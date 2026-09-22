import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookUp, Clock, MoreVertical, Edit3, Trash2, RotateCcw, AlertTriangle } from 'lucide-react'

function formatCompact(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

const STATUS_LABELS = { unread: '未读', in_progress: '未读完', completed: '已读完' }

const STATUS_STYLES = {
  unread: {
    background: 'var(--hover-bg)',
    color: 'var(--ink-muted)',
    border: '1px solid var(--border-subtle)',
  },
  in_progress: {
    background: 'rgba(196,154,60,0.1)',
    color: '#9a6f12',
    border: '1px solid rgba(196,154,60,0.18)',
  },
  completed: {
    background: 'var(--teal-bg)',
    color: '#0b7a70',
    border: '1px solid var(--teal-border)',
  },
}

const ImportItemList = memo(function ImportItemList({ items, onEdit, onMoveToReading, onDelete, onReset, readingMarks, activeFilter }) {
  const [deleteTargetItem, setDeleteTargetItem] = useState(null)
  const [resetTargetItem, setResetTargetItem] = useState(null)
  const [moreMenuId, setMoreMenuId] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)
  const dialogRef = useRef(null)
  const cancelButtonRef = useRef(null)
  const returnFocusRef = useRef(null)
  const fallbackFocusRef = useRef(null)
  const resetDialogRef = useRef(null)
  const resetCancelButtonRef = useRef(null)
  const dialogId = useId()

  function handleDeleteClick(item) {
    setDeleteTargetItem(item)
  }

  function confirmDelete() {
    if (deleteTargetItem) {
      // The deleted row may disappear after the async callback finishes.
      returnFocusRef.current = fallbackFocusRef.current
      onDelete(deleteTargetItem)
    }
    setDeleteTargetItem(null)
  }

  const cancelDelete = useCallback(() => setDeleteTargetItem(null), [])

  function handleResetClick(item, trigger) {
    returnFocusRef.current = trigger || null
    fallbackFocusRef.current = trigger?.closest('main') || null
    setResetTargetItem(item)
  }

  function confirmReset() {
    if (resetTargetItem) {
      // The reset row also leaves the shelf (status → reading), so return focus to the list.
      returnFocusRef.current = fallbackFocusRef.current
      onReset(resetTargetItem)
    }
    setResetTargetItem(null)
  }

  const cancelReset = useCallback(() => setResetTargetItem(null), [])

  // Filter items based on activeFilter
  const filteredItems = activeFilter && activeFilter !== 'all'
    ? (items || []).filter(item => (item.readingStatus || 'unread') === activeFilter)
    : (items || [])
  const deleteOpen = !!deleteTargetItem && filteredItems.some(item => item.id === deleteTargetItem.id)
  const resetOpen = !!resetTargetItem && filteredItems.some(item => item.id === resetTargetItem.id)

  useEffect(() => {
    if (!deleteOpen) return
    const root = document.getElementById('root')
    const previousInert = root?.inert
    const previousOverflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    cancelButtonRef.current?.focus({ preventScroll: true })

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelDelete()
      }
      if (event.key !== 'Tab') return
      const buttons = [...(dialogRef.current?.querySelectorAll('button:not(:disabled)') || [])]
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (!first) { event.preventDefault(); dialogRef.current?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !buttons.includes(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !buttons.includes(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (root) root.inert = previousInert
      document.body.style.overflow = previousOverflow
      const target = returnFocusRef.current?.isConnected ? returnFocusRef.current : fallbackFocusRef.current
      if (target?.isConnected && !target.closest('[inert]')) {
        const previousTabIndex = target.getAttribute('tabindex')
        if (previousTabIndex === null) target.setAttribute('tabindex', '-1')
        target.focus({ preventScroll: true })
        // Removing tabindex immediately blurs a non-scrollable main in Chromium.
        if (previousTabIndex === null) target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
      }
    }
  }, [deleteOpen, cancelDelete])

  useEffect(() => {
    if (deleteTargetItem && !deleteOpen) cancelDelete()
  }, [deleteTargetItem, deleteOpen, cancelDelete])

  useEffect(() => {
    if (!resetOpen) return
    const root = document.getElementById('root')
    const previousInert = root?.inert
    const previousOverflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    resetCancelButtonRef.current?.focus({ preventScroll: true })

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelReset()
      }
      if (event.key !== 'Tab') return
      const buttons = [...(resetDialogRef.current?.querySelectorAll('button:not(:disabled)') || [])]
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (!first) { event.preventDefault(); resetDialogRef.current?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !buttons.includes(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !buttons.includes(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (root) root.inert = previousInert
      document.body.style.overflow = previousOverflow
      const target = returnFocusRef.current?.isConnected ? returnFocusRef.current : fallbackFocusRef.current
      if (target?.isConnected && !target.closest('[inert]')) {
        const previousTabIndex = target.getAttribute('tabindex')
        if (previousTabIndex === null) target.setAttribute('tabindex', '-1')
        target.focus({ preventScroll: true })
        if (previousTabIndex === null) target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
      }
    }
  }, [resetOpen, cancelReset])

  useEffect(() => {
    if (resetTargetItem && !resetOpen) cancelReset()
  }, [resetTargetItem, resetOpen, cancelReset])

  // Filter empty — show filter-specific empty state
  if (activeFilter && activeFilter !== 'all' && filteredItems.length === 0) {
    if (activeFilter === 'unread') {
      return (
        <div
          className="flex flex-col items-center justify-center py-16"
          style={{ color: 'var(--ink-muted)' }}
        >
          <span style={{ fontSize: '40px', marginBottom: '16px', opacity: 0.7 }}>🎉</span>
          <p style={{ fontSize: '13px', fontFamily: 'DM Sans', lineHeight: 1.6 }}>
            导入新的内容来扩充你的书架。
          </p>
        </div>
      )
    }
    if (activeFilter === 'in_progress') {
      return (
        <div
          className="flex flex-col items-center justify-center py-16"
          style={{ color: 'var(--ink-muted)' }}
        >
          <span style={{ fontSize: '40px', marginBottom: '16px', opacity: 0.7 }}>📚</span>
          <p style={{ fontSize: '13px', fontFamily: 'DM Sans', lineHeight: 1.6 }}>
            所有内容要么还没开始，要么已经读完。
          </p>
        </div>
      )
    }
    if (activeFilter === 'completed') {
      return (
        <div
          className="flex flex-col items-center justify-center py-16"
          style={{ color: 'var(--ink-muted)' }}
        >
          <span style={{ fontSize: '40px', marginBottom: '16px', opacity: 0.7 }}>📖</span>
          <p style={{ fontSize: '13px', fontFamily: 'DM Sans', lineHeight: 1.6 }}>
            取一篇文章去读，读完后再回来看吧。
          </p>
        </div>
      )
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {filteredItems.map((item) => {
          const status = item.readingStatus || 'unread'
          const statusInfo = STATUS_STYLES[status] || STATUS_STYLES.unread
          const progressPercent = readingMarks?.[item.id]?.progressPercent ?? 0
          const isHovered = hoveredId === item.id

          return (
            <div
              key={item.id}
              className="item-row-status"
              data-status={status}
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--card-bg-warm)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '16px',
                padding: '18px 20px',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                position: 'relative',
                borderColor: isHovered ? 'rgba(196,154,60,0.25)' : 'var(--border-subtle)',
                boxShadow: isHovered ? 'var(--card-shadow-hover)' : 'none',
                transform: isHovered ? 'translateY(-1px)' : 'none',
              }}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Content area — click to edit */}
              <div onClick={() => onEdit(item)} style={{ flex: 1, minWidth: 0 }}>
                {/* Title */}
                <p style={{
                  fontFamily: '"Playfair Display", Georgia, serif',
                  fontSize: '16px',
                  fontWeight: 600,
                  color: 'var(--ink)',
                  lineHeight: 1.35,
                  marginBottom: '7px',
                  letterSpacing: '-0.01em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>{item.title}</p>

                {/* Meta row: date | kind | wordCount | status pill */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  fontFamily: 'DM Sans',
                  color: 'var(--ink-muted)',
                }}>
                  <span>{formatDate(item.createdAt)}</span>
                  <span style={{ color: 'var(--meta-sep-color)', fontWeight: 300 }}>|</span>
                  <span style={{ fontWeight: 500, color: item.kind === 'book' ? 'var(--teal)' : 'var(--ink-muted)' }}>
                    {item.kind === 'book' ? '书籍' : '文章'}
                  </span>
                  <span style={{ color: 'var(--meta-sep-color)', fontWeight: 300 }}>|</span>
                  <span>{formatCompact(item.totalWordCount)} 词</span>
                  <span style={{ color: 'var(--meta-sep-color)', fontWeight: 300 }}>|</span>
                  {/* Status pill */}
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 500,
                    padding: '0 7px',
                    borderRadius: '6px',
                    whiteSpace: 'nowrap',
                    background: statusInfo.background,
                    color: statusInfo.color,
                    border: statusInfo.border,
                  }}>{STATUS_LABELS[status]}</span>
                </div>
              </div>

              {/* Right actions — hover reveal */}
              <div
                className="item-actions-hover"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexShrink: 0,
                  paddingLeft: '12px',
                  opacity: isHovered ? 1 : 0,
                  transition: 'opacity 0.15s ease',
                }}
              >
                {/* Adaptive main button */}
                {status === 'completed' ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleResetClick(item, e.currentTarget) }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '8px 14px',
                      borderRadius: '10px',
                      border: '1px solid var(--surface-border)',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 500,
                      fontFamily: 'DM Sans',
                      color: 'var(--ink-muted)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <RotateCcw size={14} />重新开始
                  </button>
                ) : status === 'in_progress' ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onMoveToReading(item) }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '8px 14px',
                      borderRadius: '10px',
                      border: 'none',
                      background: 'var(--gold)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 500,
                      fontFamily: 'DM Sans',
                      color: '#fff',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <BookUp size={14} />{progressPercent}%
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onMoveToReading(item) }}
                    title="取书"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '8px 12px',
                      borderRadius: '10px',
                      border: 'none',
                      background: '#3d3834',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 500,
                      fontFamily: 'DM Sans',
                      color: '#fff',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <BookUp size={14} />
                  </button>
                )}

                {/* More menu */}
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      returnFocusRef.current = e.currentTarget
                      fallbackFocusRef.current = e.currentTarget.closest('main')
                      setMoreMenuId(moreMenuId === item.id ? null : item.id)
                    }}
                    title="更多"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: 'var(--ink-muted)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <MoreVertical size={15} />
                  </button>
                  {moreMenuId === item.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMoreMenuId(null) }} />
                      <div style={{
                        position: 'absolute',
                        right: 0,
                        bottom: '100%',
                        marginBottom: '4px',
                        zIndex: 30,
                        background: 'var(--popup-bg)',
                        boxShadow: 'var(--popup-shadow)',
                        border: '1px solid var(--popup-border)',
                        borderRadius: '12px',
                        padding: '4px',
                        minWidth: '76px',
                      }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); onEdit(item); setMoreMenuId(null) }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            width: '100%',
                            padding: '6px 10px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontFamily: 'DM Sans',
                            color: 'var(--ink-light)',
                            borderRadius: '8px',
                            textAlign: 'left',
                          }}
                        >
                          <Edit3 size={12} />编辑
                        </button>
                        {status === 'in_progress' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleResetClick(item, e.currentTarget); setMoreMenuId(null) }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              width: '100%',
                              padding: '6px 10px',
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontFamily: 'DM Sans',
                              color: 'var(--ink-light)',
                              borderRadius: '8px',
                              textAlign: 'left',
                            }}
                          >
                            <RotateCcw size={12} />重新开始
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteClick(item); setMoreMenuId(null) }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            width: '100%',
                            padding: '6px 10px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontFamily: 'DM Sans',
                            color: '#dc2626',
                            borderRadius: '8px',
                            textAlign: 'left',
                          }}
                        >
                          <Trash2 size={12} />删除
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Delete confirmation modal */}
      {deleteOpen ? createPortal(
        <div
          className="delete-confirm-backdrop"
          style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)', overscrollBehavior: 'contain' }}
          onClick={(e) => e.target === e.currentTarget && cancelDelete()}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-title`}
            aria-describedby={`${dialogId}-description`}
            tabIndex={-1}
            className="delete-confirm-dialog rounded-3xl p-8 w-full"
            style={{
              maxWidth: '420px',
              background: 'var(--popup-bg)',
              boxShadow: 'var(--popup-shadow)',
              border: '1px solid var(--popup-border)',
            }}
          >
            <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
              <div aria-hidden="true" style={{ flexShrink: 0, width: '36px', height: '36px', borderRadius: '50%', background: 'var(--danger-bg)', color: 'var(--danger-text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p id={`${dialogId}-title`} style={{ fontFamily: 'DM Sans', fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '8px' }}>
                  删除内容
                </p>
                <p id={`${dialogId}-description`} style={{ fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', lineHeight: 1.7 }}>
                  确定要删除 <span style={{ color: 'var(--ink)', fontWeight: 600, overflowWrap: 'anywhere' }}>《{deleteTargetItem.title}》</span> 吗？所有关联的书签和阅读进度都将被清除，<span style={{ color: 'var(--danger-text)', fontWeight: 500 }}>此操作不可撤销</span>。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 justify-end" style={{ marginTop: '20px' }}>
              <button
                ref={cancelButtonRef}
                onClick={cancelDelete}
                className="rounded-xl px-5 py-2.5 transition-all"
                style={{ background: 'transparent', color: 'var(--ink-muted)', border: '1px solid var(--surface-border)', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500 }}
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-xl px-5 py-2.5 transition-all"
                style={{ background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#b91c1c')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#dc2626')}
              >
                删除
              </button>
            </div>
          </div>
        </div>, document.body
      ) : null}

      {/* Reset confirmation modal */}
      {resetOpen ? createPortal(
        <div
          className="delete-confirm-backdrop"
          style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)', overscrollBehavior: 'contain' }}
          onClick={(e) => e.target === e.currentTarget && cancelReset()}
        >
          <div
            ref={resetDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-reset-title`}
            aria-describedby={`${dialogId}-reset-description`}
            tabIndex={-1}
            className="delete-confirm-dialog rounded-3xl p-8 w-full"
            style={{
              maxWidth: '420px',
              background: 'var(--popup-bg)',
              boxShadow: 'var(--popup-shadow)',
              border: '1px solid var(--popup-border)',
            }}
          >
            <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
              <div aria-hidden="true" style={{ flexShrink: 0, width: '36px', height: '36px', borderRadius: '50%', background: 'var(--danger-bg)', color: 'var(--danger-text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p id={`${dialogId}-reset-title`} style={{ fontFamily: 'DM Sans', fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '8px' }}>
                  重新开始
                </p>
                <p id={`${dialogId}-reset-description`} style={{ fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', lineHeight: 1.7 }}>
                  确定要重新开始 <span style={{ color: 'var(--ink)', fontWeight: 600, overflowWrap: 'anywhere' }}>《{resetTargetItem.title}》</span> 吗？所有关联的书签和阅读进度都将被清除，<span style={{ color: 'var(--danger-text)', fontWeight: 500 }}>此操作不可撤销</span>。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 justify-end" style={{ marginTop: '20px' }}>
              <button
                ref={resetCancelButtonRef}
                onClick={cancelReset}
                className="rounded-xl px-5 py-2.5 transition-all"
                style={{ background: 'transparent', color: 'var(--ink-muted)', border: '1px solid var(--surface-border)', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500 }}
              >
                取消
              </button>
              <button
                onClick={confirmReset}
                className="rounded-xl px-5 py-2.5 transition-all"
                style={{ background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#b91c1c')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#dc2626')}
              >
                重新开始
              </button>
            </div>
          </div>
        </div>, document.body
      ) : null}
    </>
  )
})

export default ImportItemList
