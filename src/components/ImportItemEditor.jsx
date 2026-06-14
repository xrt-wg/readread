import { useState, useRef, useCallback, useEffect } from 'react'
import { X, Save } from 'lucide-react'

/**
 * 素材编辑面板（模态框形式）。
 * 支持编辑 title、author 和每个 section 的 heading / body.text / body.markdown。
 * isDirty 检测：关闭前比较快照与当前值，未保存时弹窗确认。
 */
export default function ImportItemEditor({ item, onSave, onClose }) {
  const [title, setTitle] = useState(item.title || '')
  const [author, setAuthor] = useState(item.author || '')
  const [sections, setSections] = useState(() => {
    return (item.sections || []).map((s) => ({
      id: s.id,
      heading: s.heading || '',
      bodyText: s.body?.text || '',
      bodyMarkdown: s.body?.markdown || null,
    }))
  })
  const [expandedSectionIdx, setExpandedSectionIdx] = useState(null)
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false)
  const [pendingClose, setPendingClose] = useState(false)
  const [saving, setSaving] = useState(false)

  // 初始值快照（用于 isDirty 检测）
  const snapshot = useRef({ title: item.title || '', author: item.author || '', sections: JSON.stringify(sections) })

  const isDirty = useCallback(() => {
    if (title !== snapshot.current.title) return true
    if (author !== snapshot.current.author) return true
    if (JSON.stringify(sections) !== snapshot.current.sections) return true
    return false
  }, [title, author, sections])

  function requestClose() {
    if (isDirty()) {
      setShowUnsavedWarning(true)
      setPendingClose(true)
    } else {
      onClose()
    }
  }

  function dismissWarning() {
    setShowUnsavedWarning(false)
    setPendingClose(false)
  }

  function confirmDiscardAndClose() {
    setShowUnsavedWarning(false)
    setPendingClose(false)
    onClose()
  }

  function updateSection(idx, field, value) {
    setSections((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const updatedSections = sections.map((s, i) => ({
        ...item.sections[i],
        heading: s.heading || null,
        body: {
          ...item.sections[i].body,
          text: s.bodyText,
          markdown: s.bodyMarkdown ?? null,
          wordCount: s.bodyText.split(/\s+/).filter(Boolean).length,
        },
      }))

      await onSave(item.id, {
        title,
        author: author || null,
        sections: updatedSections,
      })

      // 更新快照为保存后的值，清除 isDirty
      snapshot.current = { title, author: author || '', sections: JSON.stringify(sections) }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-12 px-4"
        style={{ background: 'rgba(28,25,23,0.45)', backdropFilter: 'blur(4px)', overscrollBehavior: 'contain' }}
        onClick={(e) => e.target === e.currentTarget && requestClose()}
      >
        <div
          className="rounded-3xl p-8 w-full"
          style={{
            maxWidth: '600px',
            background: '#ffffff',
            boxShadow: '0 4px 24px rgba(28,25,23,0.08)',
            border: '1px solid rgba(28,25,23,0.06)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '18px', fontWeight: 600, color: 'var(--ink)' }}>
              编辑素材
            </p>
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-lg p-1.5 transition-all"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(28,25,23,0.06)'; e.currentTarget.style.color = 'var(--ink)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Title */}
          <div className="mb-4">
            <label style={{ display: 'block', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '6px' }}>
              标题
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)' }}
            />
          </div>

          {/* Author */}
          <div className="mb-6">
            <label style={{ display: 'block', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '6px' }}>
              作者
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)' }}
            />
          </div>

          {/* Sections */}
          <div className="mb-6">
            <p style={{ fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '8px' }}>
              章节（{sections.length} 节）
            </p>
            <div className="flex flex-col gap-2" style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {sections.map((s, idx) => (
                <div
                  key={s.id}
                  className="rounded-xl"
                  style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.07)' }}
                >
                  <button
                    onClick={() => setExpandedSectionIdx(expandedSectionIdx === idx ? null : idx)}
                    className="w-full flex items-center justify-between px-4 py-3 transition-all"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span style={{ fontFamily: 'DM Sans', fontSize: '13px', fontWeight: 500, color: 'var(--ink)' }}>
                      § {s.heading || `章节 ${idx + 1}`}
                    </span>
                    <span style={{ fontFamily: 'DM Sans', fontSize: '11px', color: 'var(--ink-muted)' }}>
                      {s.bodyText.split(/\s+/).filter(Boolean).length} 词
                    </span>
                  </button>
                  {expandedSectionIdx === idx && (
                    <div className="px-4 pb-4">
                      <div className="mb-3">
                        <label style={{ display: 'block', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-muted)', fontFamily: 'DM Sans', marginBottom: '4px' }}>
                          章节标题
                        </label>
                        <input
                          type="text"
                          value={s.heading}
                          onChange={(e) => updateSection(idx, 'heading', e.target.value)}
                          style={{ width: '100%', background: '#fff', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', fontFamily: 'DM Sans', color: 'var(--ink)' }}
                        />
                      </div>
                      <div className="mb-3">
                        <label style={{ display: 'block', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-muted)', fontFamily: 'DM Sans', marginBottom: '4px' }}>
                          正文
                        </label>
                        <textarea
                          value={s.bodyText}
                          onChange={(e) => updateSection(idx, 'bodyText', e.target.value)}
                          rows={6}
                          style={{ width: '100%', background: '#fff', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', fontFamily: '"Lora", Georgia, serif', color: 'var(--ink)', lineHeight: 1.6, resize: 'vertical' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Save button */}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl px-6 py-3 transition-all"
              style={{ background: 'var(--ink)', color: '#fff', border: 'none', cursor: saving ? 'default' : 'pointer', fontSize: '14px', fontFamily: 'DM Sans', fontWeight: 500, opacity: saving ? 0.7 : 1 }}
              onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = '#2d2926' }}
              onMouseLeave={(e) => { if (!saving) e.currentTarget.style.background = 'var(--ink)' }}
            >
              <Save size={14} />
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>

      {/* Unsaved changes warning */}
      {showUnsavedWarning ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-4"
          style={{ background: 'rgba(28,25,23,0.5)' }}
        >
          <div
            className="rounded-3xl p-8 w-full"
            style={{
              maxWidth: '380px',
              background: '#ffffff',
              boxShadow: '0 4px 24px rgba(28,25,23,0.08)',
              border: '1px solid rgba(28,25,23,0.06)',
            }}
          >
            <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '12px' }}>
              放弃修改？
            </p>
            <p style={{ fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: '20px' }}>
              有未保存的修改。关闭编辑器将丢失所有更改。
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={dismissWarning} className="rounded-xl px-5 py-2.5 transition-all" style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid rgba(28,25,23,0.15)', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500 }}>
                继续编辑
              </button>
              <button onClick={confirmDiscardAndClose} className="rounded-xl px-5 py-2.5 transition-all" style={{ background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500 }}>
                放弃修改
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
