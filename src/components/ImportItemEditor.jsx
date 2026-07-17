import { useState, useRef, useCallback } from 'react'
import { ArrowLeft, Save, Bold, Italic, Link, Heading2, Heading3, Eye, BookMarked, FileText, Edit3, ChevronsUpDown } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { extractRawText } from '../utils/markdownUtils'

// ─── 格式工具栏 ──────────────────────────────────────────────────────

function ToolbarButton({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick} title={label}
      className="flex items-center justify-center rounded-lg transition-all"
      style={{ width: 30, height: 30, background: 'transparent', border: '1px solid rgba(28,25,23,0.1)', cursor: 'pointer', color: 'var(--ink-muted)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(28,25,23,0.06)'; e.currentTarget.style.color = 'var(--ink)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}>
      <Icon size={14} />
    </button>
  )
}

function insertAtCursor(textarea, before, after = '') {
  const start = textarea.selectionStart; const end = textarea.selectionEnd
  const selected = textarea.value.substring(start, end)
  return { value: textarea.value.substring(0, start) + before + selected + after + textarea.value.substring(end), cursor: start + before.length + selected.length + after.length }
}

function FormatToolbar({ textareaRef, onUpdate }) {
  const handle = (before, after = '') => {
    const ta = textareaRef.current; if (!ta) return
    const { value, cursor } = insertAtCursor(ta, before, after)
    ta.value = value; ta.selectionStart = cursor; ta.selectionEnd = cursor
    ta.focus(); onUpdate(value)
  }
  return (
    <div className="flex items-center gap-1 mb-2">
      <ToolbarButton icon={Heading2} label="二级标题" onClick={() => handle('\n## ', '\n')} />
      <ToolbarButton icon={Heading3} label="三级标题" onClick={() => handle('\n### ', '\n')} />
      <ToolbarButton icon={Bold} label="加粗" onClick={() => handle('**', '**')} />
      <ToolbarButton icon={Italic} label="斜体" onClick={() => handle('*', '*')} />
      <ToolbarButton icon={Link} label="链接" onClick={() => handle('[', '](url)')} />
    </div>
  )
}

// ─── Markdown 预览 ─────────────────────────────────────────────────

function MarkdownPreview({ markdown }) {
  if (!markdown) return <p style={{ fontFamily: 'DM Sans', fontSize: '13px', color: 'var(--ink-muted)', opacity: 0.5, padding: '48px', textAlign: 'center' }}>暂无内容</p>
  return (
    <div className="article-content" style={{ fontFamily: '"Lora", Georgia, serif', fontSize: '18px', lineHeight: 1.9, color: 'var(--ink-light)', letterSpacing: '0.01em' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ marginBottom: '1.6em' }}>{children}</p>,
          h1: ({ children }) => <h1 className="article-h1">{children}</h1>,
          h2: ({ children }) => <h2 className="article-h2">{children}</h2>,
          h3: ({ children }) => <h3 className="article-h3">{children}</h3>,
          h4: ({ children }) => <h4 className="article-h4">{children}</h4>,
          ul: ({ children }) => <ul className="article-ul">{children}</ul>,
          ol: ({ children }) => <ol className="article-ol">{children}</ol>,
          li: ({ children }) => <li className="article-li">{children}</li>,
          blockquote: ({ children }) => <blockquote className="article-quote">{children}</blockquote>,
          code: ({ inline, children }) => inline
            ? <code className="article-inline-code">{children}</code>
            : <pre className="article-code-block"><code>{children}</code></pre>,
          img: ({ src, alt }) => <img src={src} alt={alt ?? ''} onError={(e) => { e.currentTarget.style.display = 'none' }} style={{ maxWidth: '100%', height: 'auto', borderRadius: '8px', margin: '1em 0', display: 'block' }} />,
        }}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

// ─── 主组件（全页面模式）────────────────────────────────────────────

export default function ImportItemEditor({ item, onSave, onClose }) {
  const [title, setTitle] = useState(item.title || '')
  const [author, setAuthor] = useState(item.author || '')
  const [kind, setKind] = useState(item.kind || 'article')
  const [sourceUrl, setSourceUrl] = useState(item.sourceUrl || '')
  const [sections, setSections] = useState(() =>
    (item.sections || []).map((s) => ({
      id: s.id, heading: s.heading || '', bodyText: s.body?.text || '', bodyMarkdown: s.body?.markdown ?? null,
    }))
  )
  const [expandedSectionIdx, setExpandedSectionIdx] = useState(0)
  const [contentView, setContentView] = useState('preview')
  const [editorSection, setEditorSection] = useState('properties')
  const [tocOpen, setTocOpen] = useState(true)
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false)
  const [saving, setSaving] = useState(false)
  const textareaRefs = useRef({})

  const snapshot = useRef({ title: item.title || '', author: item.author || '', kind: item.kind || 'article', sourceUrl: item.sourceUrl || '', sections: JSON.stringify(sections) })

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

  function updateSection(idx, field, value) {
    setSections((prev) => { const next = [...prev]; next[idx] = { ...next[idx], [field]: value }; return next })
  }

  function handleMarkdownChange(idx, value) {
    const text = extractRawText(value) || value
    setSections((prev) => { const next = [...prev]; next[idx] = { ...next[idx], bodyMarkdown: value, bodyText: text }; return next })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const updatedSections = sections.map((s, i) => ({
        ...item.sections[i], heading: s.heading || null,
        body: { text: s.bodyText, markdown: s.bodyMarkdown ?? null, wordCount: s.bodyText.split(/\s+/).filter(Boolean).length },
      }))
      await onSave(item.id, { title, author: author || null, kind, source_url: sourceUrl || null, sections: updatedSections })
      snapshot.current = { title, author: author || '', kind, sourceUrl: sourceUrl || '', sections: JSON.stringify(sections) }
    } finally { setSaving(false) }
  }

  const hasMultipleSections = sections.length > 1

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--parchment)' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(28,25,23,0.06)', background: '#ffffff' }}>
        <div className="flex items-center gap-4">
          <button onClick={requestClose}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 transition-all"
            style={{ background: 'transparent', border: '1px solid rgba(28,25,23,0.1)', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(28,25,23,0.06)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
            <ArrowLeft size={15} />返回书架
          </button>
        </div>
        <div className="flex gap-0.5 p-0.5 rounded-xl" style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)' }}>
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
          style={{ background: isDirty() ? 'var(--ink)' : 'rgba(28,25,23,0.15)', color: isDirty() ? '#fff' : 'rgba(28,25,23,0.4)', border: 'none', cursor: isDirty() && !saving ? 'pointer' : 'default', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, opacity: saving ? 0.7 : 1 }}
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
          <div className="rounded-2xl px-6 py-5 flex-shrink-0" style={{ background: '#ffffff', border: '1px solid rgba(28,25,23,0.07)', boxShadow: '0 1px 4px rgba(28,25,23,0.04)' }}>
            <div className="flex flex-col gap-4" style={{ maxWidth: '520px' }}>
              <div>
                <label className="block mb-1.5" style={{ fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)' }}>标题</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                  style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '10px', padding: '11px 14px', fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)' }} />
              </div>
              <div>
                <label className="block mb-1.5" style={{ fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)' }}>作者</label>
                <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)}
                  style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '10px', padding: '11px 14px', fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)' }} />
              </div>
              <div>
                <label className="block mb-1.5" style={{ fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)' }}>形态</label>
                <div className="flex gap-1 p-0.5 rounded-xl" style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', maxWidth: '200px' }}>
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
                  style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '10px', padding: '11px 14px', fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)' }} />
              </div>
            </div>
          </div>

          )}
          {/* 内容编辑区 */}
          {editorSection === 'content' && (
            <div className="rounded-2xl flex-1 flex" style={{ background: '#ffffff', border: '1px solid rgba(28,25,23,0.07)', boxShadow: '0 1px 4px rgba(28,25,23,0.04)', overflow: 'hidden' }}>

            {/* 左侧：章节目录（仅多章节时显示，可折叠） */}
            {hasMultipleSections && tocOpen && (
            <div className="flex flex-col flex-shrink-0" style={{ width: '200px', borderRight: '1px solid rgba(28,25,23,0.06)', background: 'var(--parchment-50)' }}>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(28,25,23,0.06)' }}>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink-muted)' }}>目录</span>
                  <span style={{ fontSize: '10px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.5 }}>{sections.length} 节</span>
                </div>
                <button onClick={() => setTocOpen(false)}
                  className="flex items-center justify-center rounded-md transition-all"
                  style={{ width: 24, height: 24, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(28,25,23,0.06)'; e.currentTarget.style.color = 'var(--ink)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}>
                  <ChevronsUpDown size={13} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-1">
                {sections.map((s, idx) => (
                  <button key={s.id} onClick={() => setExpandedSectionIdx(idx)}
                    className="w-full text-left px-4 py-2.5 transition-all"
                    style={{
                      background: expandedSectionIdx === idx ? '#ffffff' : 'transparent',
                      border: 'none', cursor: 'pointer',
                      borderLeft: expandedSectionIdx === idx ? '2px solid var(--gold)' : '2px solid transparent',
                    }}>
                    <p className="truncate" style={{ fontFamily: 'DM Sans', fontSize: '12px', fontWeight: expandedSectionIdx === idx ? 600 : 400, color: expandedSectionIdx === idx ? 'var(--ink)' : 'var(--ink-muted)', marginBottom: '2px' }}>
                      {s.heading || `章节 ${idx + 1}`}
                    </p>
                    <span style={{ fontFamily: 'DM Sans', fontSize: '10px', color: 'var(--ink-muted)', opacity: 0.6 }}>{s.bodyText.split(/\s+/).filter(Boolean).length} 词</span>
                  </button>
                ))}
              </div>
            </div>
            )}
            {/* 折叠态展开按钮 */}
            {hasMultipleSections && !tocOpen && (
            <button onClick={() => setTocOpen(true)}
              className="flex-shrink-0 flex items-center justify-center transition-all"
              style={{ width: '32px', background: 'var(--parchment-50)', border: 'none', borderRight: '1px solid rgba(28,25,23,0.06)', cursor: 'pointer', color: 'var(--ink-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'rgba(196,154,60,0.06)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-muted)'; e.currentTarget.style.background = 'var(--parchment-50)' }}>
              <ChevronsUpDown size={14} style={{ transform: 'rotate(90deg)' }} />
            </button>
            )}

            {/* 右侧：章节内容编辑/预览 */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* 右侧顶栏：编辑/预览切换 */}
              <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(28,25,23,0.06)' }}>
                {hasMultipleSections ? (
                  <input type="text" value={sections[expandedSectionIdx]?.heading || ''} onChange={(e) => updateSection(expandedSectionIdx, 'heading', e.target.value)}
                    placeholder={`章节 ${(expandedSectionIdx ?? 0) + 1}`}
                    className="truncate"
                    style={{ flex: 1, marginRight: '12px', background: 'transparent', border: '1px solid rgba(28,25,23,0.08)', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink)' }} />
                ) : (
                  <span />
                )}
                <div className="flex gap-0.5 p-0.5 rounded-lg flex-shrink-0" style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)' }}>
                  <button onClick={() => setContentView('edit')}
                    className="flex items-center gap-1 rounded-md px-2 py-1 transition-all"
                    style={{ fontSize: '11px', fontFamily: 'DM Sans', fontWeight: contentView === 'edit' ? 600 : 400, background: contentView === 'edit' ? 'rgba(196,154,60,0.12)' : 'transparent', color: contentView === 'edit' ? 'var(--gold-dark)' : 'var(--ink-muted)', border: 'none', cursor: 'pointer' }}>
                    <Edit3 size={11} />编辑
                  </button>
                  <button onClick={() => setContentView('preview')}
                    className="flex items-center gap-1 rounded-md px-2 py-1 transition-all"
                    style={{ fontSize: '11px', fontFamily: 'DM Sans', fontWeight: contentView === 'preview' ? 600 : 400, background: contentView === 'preview' ? 'rgba(196,154,60,0.12)' : 'transparent', color: contentView === 'preview' ? 'var(--gold-dark)' : 'var(--ink-muted)', border: 'none', cursor: 'pointer' }}>
                    <Eye size={11} />预览
                  </button>
                </div>
              </div>

              {/* 右侧内容：当前选中章节 */}
              <div className="flex-1 p-5" style={{ overflowY: 'auto' }}>
                {expandedSectionIdx != null && sections[expandedSectionIdx] && (() => {
                  const s = sections[expandedSectionIdx]
                  const idx = expandedSectionIdx
                  const hasMarkdown = s.bodyMarkdown !== null
                  return (
                    <div>
                      {hasMarkdown ? (
                        contentView === 'edit' ? (
                          <div>
                            <FormatToolbar textareaRef={textareaRefs.current[idx]} onUpdate={(val) => handleMarkdownChange(idx, val)} />
                            <textarea
                              ref={(el) => { if (el) { textareaRefs.current[idx] = el; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                              value={s.bodyMarkdown || ''}
                              onChange={(e) => { handleMarkdownChange(idx, e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
                              style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '8px', padding: '14px 16px', fontSize: '14px', fontFamily: '"JetBrains Mono", "Fira Code", monospace', color: 'var(--ink)', lineHeight: 1.8, resize: 'none', overflow: 'hidden' }} />
                          </div>
                        ) : (
                          <div style={{ background: '#fdfaf5', border: '1px solid rgba(28,25,23,0.06)', borderRadius: '8px', padding: '28px 40px' }}>
                            <MarkdownPreview markdown={s.bodyMarkdown} />
                          </div>
                        )
                      ) : (
                        <textarea value={s.bodyText} onChange={(e) => updateSection(idx, 'bodyText', e.target.value)} rows={20}
                          style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '8px', padding: '12px 14px', fontSize: '14px', fontFamily: '"Lora", Georgia, serif', color: 'var(--ink)', lineHeight: 1.8, resize: 'vertical' }} />
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
          )}

        </div>
      </div>

      {/* Unsaved changes warning */}
      {showUnsavedWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" style={{ background: 'rgba(28,25,23,0.5)' }}>
          <div className="rounded-3xl p-8 w-full" style={{ maxWidth: '380px', background: '#ffffff', boxShadow: '0 4px 24px rgba(28,25,23,0.08)', border: '1px solid rgba(28,25,23,0.06)' }}>
            <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '12px' }}>放弃修改？</p>
            <p style={{ fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', lineHeight: 1.7, marginBottom: '20px' }}>有未保存的修改。返回书架将丢失所有更改。</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowUnsavedWarning(false)}
                className="rounded-xl px-5 py-2.5 transition-all"
                style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid rgba(28,25,23,0.15)', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500 }}>继续编辑</button>
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
