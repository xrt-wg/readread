import { useState } from 'react'
import { BookOpen, Clock, FileText, MoreVertical, Edit3, Trash2 } from 'lucide-react'

function formatCompact(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export default function ImportItemList({ items, importCounts, onEdit, onMoveToReading, onDelete }) {
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteHasRefs, setDeleteHasRefs] = useState(false)
  const [moreMenuId, setMoreMenuId] = useState(null)

  function handleDeleteClick(itemId, hasRefs) {
    setDeleteTarget(itemId)
    setDeleteHasRefs(hasRefs)
  }

  function confirmDelete() {
    if (deleteTarget) {
      onDelete(deleteTarget)
    }
    setDeleteTarget(null)
    setDeleteHasRefs(false)
  }

  function cancelDelete() {
    setDeleteTarget(null)
    setDeleteHasRefs(false)
  }

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

  return (
    <>
      <div className="flex flex-col gap-2">
        {items.map((item) => {
          const refCount = importCounts[item.id] || 0

          return (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-2xl px-5 py-4 bg-white border transition-all"
              style={{
                borderColor: 'rgba(28,25,23,0.07)',
                boxShadow: '0 1px 4px rgba(28,25,23,0.04)',
              }}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="truncate"
                  title={item.title}
                  style={{ maxWidth: '320px',
                    fontFamily: '"Playfair Display", Georgia, serif',
                    fontSize: '15px',
                    fontWeight: 600,
                    color: 'var(--ink)',
                    marginBottom: '4px',
                  }}
                >
                  {item.title}
                </p>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1" style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)' }}>
                    <Clock size={11} />
                    {formatDate(item.createdAt)}
                  </span>
                  <span style={{ fontSize: '12px', color: 'rgba(28,25,23,0.2)' }}>·</span>
                  <span style={{ fontSize: '12px', fontFamily: 'DM Sans', fontWeight: 500, color: item.kind === 'book' ? '#0d9488' : 'var(--ink-muted)' }}>
                    {item.kind === 'book' ? '书籍' : '文章'}
                  </span>
                  <span style={{ fontSize: '12px', color: 'rgba(28,25,23,0.2)' }}>·</span>
                  <span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)' }}>
                    {formatCompact(item.totalWordCount)} 词
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 ml-auto">
                <button
                  onClick={() => onMoveToReading(item)}
                  title="移入阅读区"
                  className="flex items-center justify-center rounded-xl transition-all"
                  style={{ width: 34, height: 34, background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#2d2926')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--ink)')}
                >
                  <BookOpen size={14} />
                </button>
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setMoreMenuId(moreMenuId === item.id ? null : item.id)}
                    title="更多"
                    className="flex items-center justify-center rounded-lg transition-all"
                    style={{ width: 30, height: 30, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(28,25,23,0.06)'; e.currentTarget.style.color = 'var(--ink)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}
                  >
                    <MoreVertical size={15} />
                  </button>
                  {moreMenuId === item.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMoreMenuId(null)} />
                      <div className="absolute left-full bottom-0 ml-1 z-20 rounded-xl py-1" style={{ background: '#ffffff', boxShadow: '0 4px 16px rgba(28,25,23,0.12)', border: '1px solid rgba(28,25,23,0.08)', minWidth: '120px' }}>
                        <button
                          onClick={() => { onEdit(item); setMoreMenuId(null) }}
                          className="w-full flex items-center gap-2 px-4 py-2.5 transition-all"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink)' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(28,25,23,0.05)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <Edit3 size={12} />编辑
                        </button>
                        <button
                          onClick={() => { handleDeleteClick(item.id, refCount > 0); setMoreMenuId(null) }}
                          className="w-full flex items-center gap-2 px-4 py-2.5 transition-all"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px', fontFamily: 'DM Sans', color: '#dc2626' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(220,38,38,0.06)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
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
              {deleteHasRefs
                ? '该素材已产生阅读副本。删除后：\n· 副本将保留在你的文章库中，可继续阅读\n· 副本不再显示「来源」信息\n\n确认删除？'
                : '确认删除该素材？此操作不可撤销。'}
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
}
