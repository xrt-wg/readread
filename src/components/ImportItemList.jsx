import { memo, useState } from 'react'
import { BookOpen, Clock, FileText, MoreVertical, Edit3, Trash2, RotateCcw } from 'lucide-react'

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
    background: 'rgba(28,25,23,0.06)',
    color: 'var(--ink-muted)',
    border: '1px solid rgba(28,25,23,0.08)',
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
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteTargetItem, setDeleteTargetItem] = useState(null)
  const [moreMenuId, setMoreMenuId] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)

  function handleDeleteClick(item) {
    setDeleteTarget(item.id)
    setDeleteTargetItem(item)
  }

  function confirmDelete() {
    if (deleteTargetItem) {
      onDelete(deleteTargetItem)
    }
    setDeleteTarget(null)
    setDeleteTargetItem(null)
  }

  function cancelDelete() {
    setDeleteTarget(null)
  }

  // Filter items based on activeFilter
  const filteredItems = activeFilter && activeFilter !== 'all'
    ? (items || []).filter(item => (item.readingStatus || 'unread') === activeFilter)
    : (items || [])

  // No items at all — show generic empty shelf state
  if (!items || items.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16"
        style={{ color: 'var(--ink-muted)' }}
      >
        <FileText size={36} style={{ opacity: 0.25, marginBottom: '16px' }} />
        <p style={{ fontSize: '14px', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '6px', color: 'var(--ink)' }}>
          书架为空
        </p>
        <p style={{ fontSize: '12px', fontFamily: 'DM Sans', lineHeight: 1.6 }}>
          导入英文内容开始策展——整理格式后再移入文章库阅读
        </p>
      </div>
    )
  }

  // Filter empty — show filter-specific empty state
  if (activeFilter && activeFilter !== 'all' && filteredItems.length === 0) {
    if (activeFilter === 'unread') {
      return (
        <div
          className="flex flex-col items-center justify-center py-16"
          style={{ color: 'var(--ink-muted)' }}
        >
          <span style={{ fontSize: '40px', marginBottom: '16px', opacity: 0.7 }}>🎉</span>
          <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: 'var(--ink)' }}>
            所有内容均已开始阅读
          </p>
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
          <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: 'var(--ink)' }}>
            没有正在阅读的内容
          </p>
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
          <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: 'var(--ink)' }}>
            还没有读完的内容
          </p>
          <p style={{ fontSize: '13px', fontFamily: 'DM Sans', lineHeight: 1.6 }}>
            打开一篇文章开始阅读，读完后再回来看吧。
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
                border: '1px solid rgba(28,25,23,0.07)',
                borderRadius: '16px',
                padding: '18px 20px',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                position: 'relative',
                borderColor: isHovered ? 'rgba(196,154,60,0.25)' : 'rgba(28,25,23,0.07)',
                boxShadow: isHovered ? '0 4px 20px rgba(28,25,23,0.07)' : 'none',
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
                    onClick={(e) => { e.stopPropagation(); onReset(item) }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '8px 14px',
                      borderRadius: '10px',
                      border: '1px solid rgba(28,25,23,0.12)',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 500,
                      fontFamily: 'DM Sans',
                      color: 'var(--ink-muted)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <RotateCcw size={14} />重新阅读
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
                    <BookOpen size={14} />继续 {progressPercent}%
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onMoveToReading(item) }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '8px 14px',
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
                    <BookOpen size={14} />开始阅读
                  </button>
                )}

                {/* More menu */}
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setMoreMenuId(moreMenuId === item.id ? null : item.id) }}
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
                        left: 0,
                        bottom: '100%',
                        marginBottom: '4px',
                        zIndex: 30,
                        background: '#fff',
                        boxShadow: '0 6px 20px rgba(28,25,23,0.1), 0 1px 3px rgba(28,25,23,0.04)',
                        border: '1px solid rgba(28,25,23,0.06)',
                        borderRadius: '12px',
                        padding: '4px',
                        minWidth: '120px',
                      }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); onEdit(item); setMoreMenuId(null) }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            width: '100%',
                            padding: '8px 12px',
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
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteClick(item); setMoreMenuId(null) }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            width: '100%',
                            padding: '8px 12px',
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
      {deleteTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-24 px-4"
          style={{ background: 'rgba(28,25,23,0.45)', backdropFilter: 'blur(4px)', overscrollBehavior: 'contain' }}
          onClick={(e) => e.target === e.currentTarget && cancelDelete()}
        >
          <div
            className="rounded-3xl p-8 w-full"
            style={{
              maxWidth: '420px',
              background: '#ffffff',
              boxShadow: '0 4px 24px rgba(28,25,23,0.08)',
              border: '1px solid rgba(28,25,23,0.06)',
            }}
          >
            <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '12px' }}>
              确认删除
            </p>
            <p style={{ fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: '20px' }}>
              确认删除该素材？所有关联的书签和阅读进度将被清除。此操作不可撤销。
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelDelete}
                className="rounded-xl px-5 py-2.5 transition-all"
                style={{ background: 'transparent', color: 'var(--ink-muted)', border: '1px solid rgba(28,25,23,0.15)', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500 }}
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
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
})

export default ImportItemList
