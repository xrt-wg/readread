import { useState, useRef, useCallback, useEffect } from 'react'
import { Book, Save, BookMarked, FileText, Edit3 } from 'lucide-react'
import { getReading } from '../services/readings'
import SectionContentEditor from './SectionContentEditor'

// ─── 主组件（全页面模式）────────────────────────────────────────────

export default function ImportItemEditor({ item, canUseCloudLibrary, userId, onSave, onClose }) {
  const [title, setTitle] = useState(item.title || '')
  const [author, setAuthor] = useState(item.author || '')
  const [kind, setKind] = useState(item.kind || 'article')
  const [sourceUrl, setSourceUrl] = useState(item.sourceUrl || '')
  // sections 保持「完整态」Section[]：懒加载后存 getReading 返回的原样 sections，
  // 编辑/保存均由 SectionContentEditor 以完整态回写（不再依赖 item.sections 的展开）。
  const [sections, setSections] = useState(() => item.sections || [])
  const [editorSection, setEditorSection] = useState('properties')
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false)
  const [saving, setSaving] = useState(false)

  const snapshot = useRef({ title: item.title || '', author: item.author || '', kind: item.kind || 'article', sourceUrl: item.sourceUrl || '', sections: JSON.stringify(item.sections || []) })

  // 按需加载完整数据：书架列表不含 sections，编辑器需要从详情接口获取正文
  useEffect(() => {
    let active = true
    getReading(item.id, { canUseCloudLibrary, userId }).then(reading => {
      if (!active || !reading) return
      setTitle(reading.title)
      setAuthor(reading.author || '')
      setKind(reading.kind || 'article')
      setSourceUrl(reading.sourceUrl || '')
      const fullSections = reading.sections || []
      setSections(fullSections)
      snapshot.current = {
        title: reading.title || '',
        author: reading.author || '',
        kind: reading.kind || 'article',
        sourceUrl: reading.sourceUrl || '',
        sections: JSON.stringify(fullSections),
      }
    }).catch(() => {}) // 静默回退，列表数据兜底
    return () => { active = false }
  }, [item.id, canUseCloudLibrary, userId])

  const isDirty = useCallback(() => {
    if (title !== snapshot.current.title) return true
    if (author !== snapshot.current.author) return true
    if (kind !== snapshot.current.kind) return true
    if (sourceUrl !== snapshot.current.sourceUrl) return true
    if (JSON.stringify(sections) !== snapshot.current.sections) return true
    return false
  }, [title, author, kind, sourceUrl, sections])

  function requestClose() {
    if (isDirty()) { setShowUnsavedWarning(true) } else { onClose() }
  }

  async function handleSave() {
    setSaving(true)
    try {
      // sections 已是完整态（含 id/depth/order/body/wordCount），直接提交
      await onSave(item.id, { title, author: author || null, kind, source_url: sourceUrl || null, sections })
      snapshot.current = { title, author: author || '', kind, sourceUrl: sourceUrl || '', sections: JSON.stringify(sections) }
    } finally { setSaving(false) }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--parchment)' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--header-bg)' }}>
        <div className="flex items-center gap-4">
          <button onClick={requestClose}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 transition-all"
            style={{ background: 'transparent', border: '1px solid var(--surface-border)', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
            <Book size={15} />返回书架
          </button>
        </div>
        <div className="flex gap-0.5 p-0.5 rounded-xl" style={{ background: 'var(--parchment-50)', border: '1px solid var(--surface-border)' }}>
          <button onClick={() => setEditorSection('properties')}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all"
            style={{ fontSize: '12px', fontFamily: 'DM Sans', fontWeight: editorSection === 'properties' ? 600 : 400, background: editorSection === 'properties' ? 'rgba(196,154,60,0.12)' : 'transparent', color: editorSection === 'properties' ? 'var(--gold-dark)' : 'var(--ink-muted)', border: 'none', cursor: 'pointer' }}>
            <FileText size={12} />属性
          </button>
          <button onClick={() => setEditorSection('content')}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all"
            style={{ fontSize: '12px', fontFamily: 'DM Sans', fontWeight: editorSection === 'content' ? 600 : 400, background: editorSection === 'content' ? 'rgba(196,154,60,0.12)' : 'transparent', color: editorSection === 'content' ? 'var(--gold-dark)' : 'var(--ink-muted)', border: 'none', cursor: 'pointer' }}>
            <Edit3 size={12} />内容
          </button>
        </div>
        <button onClick={handleSave} disabled={saving || !isDirty()}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 transition-all"
          style={{ background: isDirty() ? 'var(--ink)' : 'var(--surface-bg)', color: isDirty() ? 'var(--on-ink)' : 'var(--ink-muted)', border: 'none', cursor: isDirty() && !saving ? 'pointer' : 'default', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, opacity: saving ? 0.7 : 1 }}
          onMouseEnter={(e) => { if (isDirty() && !saving) e.currentTarget.style.background = 'var(--btn-hover-bg)' }}
          onMouseLeave={(e) => { if (isDirty() && !saving) e.currentTarget.style.background = 'var(--ink)' }}>
          <Save size={14} />{saving ? '保存中…' : '保存'}
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6 flex justify-center">
        <div className="w-full flex flex-col gap-5" style={{ maxWidth: '860px' }}>

          {/* 属性编辑区 */}
          {editorSection === 'properties' && (
          <div className="rounded-2xl px-6 py-5 flex-shrink-0" style={{ background: 'var(--card-bg-warm)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--card-shadow)', maxWidth: '560px', width: '100%', margin: '0 auto' }}>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block mb-1.5" style={{ fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)' }}>标题</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                  style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid var(--surface-border)', borderRadius: '10px', padding: '11px 14px', fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)' }} />
              </div>
              <div>
                <label className="block mb-1.5" style={{ fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)' }}>作者</label>
                <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)}
                  style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid var(--surface-border)', borderRadius: '10px', padding: '11px 14px', fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)' }} />
              </div>
              <div>
                <label className="block mb-1.5" style={{ fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)' }}>类型</label>
                <div className="flex gap-1 p-0.5 rounded-xl" style={{ background: 'var(--parchment-50)', border: '1px solid var(--surface-border)', maxWidth: '200px' }}>
                  {[{ id: 'article', icon: FileText, label: '文章' }, { id: 'book', icon: BookMarked, label: '书籍' }].map(({ id, icon: Icon, label }) => (
                    <button key={id} onClick={() => setKind(id)}
                      className="flex items-center justify-center gap-1.5 flex-1 rounded-lg transition-all"
                      style={{ padding: '9px 8px', fontSize: '12px', fontFamily: 'DM Sans', fontWeight: kind === id ? 600 : 400, background: kind === id ? 'rgba(196,154,60,0.11)' : 'transparent', color: kind === id ? 'var(--gold-dark)' : 'var(--ink-muted)', border: 'none', cursor: 'pointer' }}>
                      <Icon size={13} />{label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block mb-1.5" style={{ fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)' }}>来源 URL</label>
                <input type="text" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..."
                  style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid var(--surface-border)', borderRadius: '10px', padding: '11px 14px', fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)' }} />
              </div>
            </div>
          </div>

          )}
          {/* 内容编辑区：复用共享「内容编辑 + 预览」组件 */}
          {editorSection === 'content' && (
            <SectionContentEditor sections={sections} onChange={setSections} allowDelete={kind === 'book'} />
          )}

        </div>
      </div>

      {/* Unsaved changes warning */}
      {showUnsavedWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}>
          <div className="rounded-3xl p-8 w-full" style={{ maxWidth: '380px', background: 'var(--popup-bg)', boxShadow: 'var(--popup-shadow)', border: '1px solid var(--popup-border)' }}>
            <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '12px' }}>放弃修改？</p>
            <p style={{ fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: '20px' }}>有未保存的修改。返回书架将丢失所有更改。</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowUnsavedWarning(false)}
                className="rounded-xl px-5 py-2.5 transition-all"
                style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--surface-border)', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500 }}>继续编辑</button>
              <button onClick={() => { setShowUnsavedWarning(false); onClose() }}
                className="rounded-xl px-5 py-2.5 transition-all"
                style={{ background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500 }}>放弃修改</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
