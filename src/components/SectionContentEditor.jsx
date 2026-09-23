import { useState, useRef, useEffect } from 'react'
import { Bold, Italic, Link, Image, Quote, Heading2, Heading3, Eye, Edit3, ChevronsUpDown, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { extractRawText } from '../utils/markdownUtils'
import { ArticleFigure, ArticleLink } from './ArticleMedia'

// ─── 格式工具栏 ──────────────────────────────────────────────────────

function ToolbarButton({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick} title={label}
      className="flex items-center justify-center rounded-lg transition-all"
      style={{ width: 30, height: 30, background: 'transparent', border: '1px solid var(--surface-border)', cursor: 'pointer', color: 'var(--ink-muted)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; e.currentTarget.style.color = 'var(--ink)' }}
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

export function MarkdownToolbar({ getTextarea, onUpdate }) {
  const handle = (before, after = '') => {
    const ta = getTextarea(); if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = ta.value.substring(start, end)
    ta.focus()
    // 优先走原生 insertText：保留浏览器撤销栈，Ctrl+Z 可以回退工具栏插入
    let inserted = false
    try {
      ta.setSelectionRange(start, end)
      inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, before + selected + after)
    } catch { inserted = false }
    if (!inserted) {
      const { value, cursor } = insertAtCursor(ta, before, after)
      ta.value = value; ta.selectionStart = cursor; ta.selectionEnd = cursor
    }
    // 工具栏插入不经过 onChange，需手动重算文本域自适应高度，否则新插入的行可能被遮挡
    ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'
    onUpdate(ta.value)
  }
  return (
    <div className="flex items-center gap-1 mb-2">
      <ToolbarButton icon={Heading2} label="二级标题" onClick={() => handle('\n## ', '\n')} />
      <ToolbarButton icon={Heading3} label="三级标题" onClick={() => handle('\n### ', '\n')} />
      <ToolbarButton icon={Quote} label="引用块" onClick={() => handle('\n> ', '\n')} />
      <ToolbarButton icon={Bold} label="加粗" onClick={() => handle('**', '**')} />
      <ToolbarButton icon={Italic} label="斜体" onClick={() => handle('*', '*')} />
      <ToolbarButton icon={Link} label="链接" onClick={() => handle('[', '](url)')} />
      <ToolbarButton icon={Image} label="图片（[说明](地址)，说明会显示在图片下方）" onClick={() => handle('![', '](图片地址)')} />
    </div>
  )
}

// ─── Markdown 预览 ─────────────────────────────────────────────────

export function MarkdownPreview({ markdown }) {
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
          a: ({ href, children }) => <ArticleLink href={href}>{children}</ArticleLink>,
          pre: ({ children }) => <pre className="article-code-block">{children}</pre>,
          // react-markdown v9+ 移除了 inline prop：块级代码经 pre 渲染并带 language-* 类名，其余视为行内代码
          code: ({ className, children }) => <code className={className?.startsWith('language-') ? className : 'article-inline-code'}>{children}</code>,
          img: ({ src, alt }) => <ArticleFigure src={src} alt={alt} />,
        }}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

// ─── 只读排版预览（等价于去掉交互的 SectionFlow） ────────────────────

/** depth → 标题 CSS 类。0→h2, 1→h3, ≥2→h4。 */
function headingClassForDepth(depth) {
  if (depth <= 0) return 'article-h2'
  if (depth === 1) return 'article-h3'
  return 'article-h4'
}

function PlainTextPreview({ text }) {
  const paragraphs = (text ?? '').split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0)
  if (paragraphs.length === 0) return null
  return (
    <>
      {paragraphs.map((para, i) => (
        <p key={i} style={{ fontFamily: '"Lora", Georgia, serif', fontSize: '18px', lineHeight: 1.9, color: 'var(--ink-light)', marginBottom: '1.6em', letterSpacing: '0.01em' }}>
          {para}
        </p>
      ))}
    </>
  )
}

export function SectionPreview({ sections }) {
  return (
    <div>
      {(sections || []).map((section) => {
        const HeadingTag = section.depth >= 1 ? (section.depth === 1 ? 'h3' : 'h4') : 'h2'
        return (
          <div key={section.id}>
            {section.heading && (
              <HeadingTag className={headingClassForDepth(section.depth)}>{section.heading}</HeadingTag>
            )}
            {section.body?.markdown != null ? (
              <MarkdownPreview markdown={section.body.markdown} />
            ) : (
              <PlainTextPreview text={section.body?.text || ''} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── 编辑态 ↔ 完整态 转换 ────────────────────────────────────────────
// 完整态 Section：{ id, heading, depth, order, body: { text, markdown, wordCount } }
// 编辑态 section：{ id, heading, depth, order, bodyText, bodyMarkdown }
// 注意（L4）：bodyMarkdown = body.markdown ?? body.text ?? null —— 与现有 ImportItemEditor
//   一致，纯文本 section 进入编辑即按 markdown 交付（纯文本语义不再保留），属既有行为。

function fullToEditing(sections) {
  return (sections || []).map((s, i) => ({
    id: s.id ?? `sec-${i}`,
    heading: s.heading || '',
    depth: s.depth ?? 0,
    order: s.order ?? i,
    bodyText: s.body?.text || '',
    bodyMarkdown: s.body?.markdown ?? s.body?.text ?? null,
  }))
}

function editingToFull(editing) {
  return editing.map((s, i) => ({
    id: s.id,
    heading: s.heading || null,
    depth: s.depth ?? 0,
    order: s.order ?? i,
    body: {
      text: s.bodyText,
      markdown: s.bodyMarkdown ?? null,
      wordCount: (s.bodyText || '').split(/\s+/).filter(Boolean).length,
    },
  }))
}

// ─── 内容编辑组件（受控于完整态） ────────────────────────────────────

/**
 * 共享「内容编辑 + 预览」核心。
 * @param {Array}  props.sections  完整态 Section[]
 * @param {(next: Section[]) => void} props.onChange  每次编辑即时回写完整态
 */
export default function SectionContentEditor({ sections, onChange, allowDelete = false }) {
  const [editing, setEditing] = useState(() => fullToEditing(sections))
  // 记录最近一次自己 emit 的完整态引用：外部数据源（懒加载/重新拉取）变化时重建编辑态，
  // 自身 onChange 的回显则忽略，避免每次按键重建编辑态导致输入光标回跳。
  const lastEmittedRef = useRef(sections)
  const [expandedSectionIdx, setExpandedSectionIdx] = useState(0)
  const [contentView, setContentView] = useState('preview')
  const [tocOpen, setTocOpen] = useState(true)
  const textareaRefs = useRef({})
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState(null)

  useEffect(() => {
    if (sections !== lastEmittedRef.current) {
      setEditing(fullToEditing(sections))
      lastEmittedRef.current = sections
      setPendingDeleteIdx(null)
    }
  }, [sections])

  function commit(nextEditing) {
    const full = editingToFull(nextEditing)
    lastEmittedRef.current = full
    setEditing(nextEditing)
    onChange(full)
  }

  function updateSection(idx, field, value) {
    commit(editing.map((s, i) => (i === idx ? { ...s, [field]: value } : s)))
  }

  function handleMarkdownChange(idx, value) {
    const text = extractRawText(value) || value
    commit(editing.map((s, i) => (i === idx ? { ...s, bodyMarkdown: value, bodyText: text } : s)))
  }

  // 节 i 的子树结束位置（开区间）：其后第一个 depth <= editing[i].depth 的节。
  // sections 为 DFS 保序（父在前、子在后），故 [i, end) 即该节连同其后代构成的整棵子树。
  function subtreeEnd(i) {
    const d = editing[i].depth
    let end = i + 1
    while (end < editing.length && editing[end].depth > d) end++
    return end
  }

  // 删除第 idx 节（含其后代子树），重排 order 保持稠密，并修正当前展开索引
  function deleteSection(idx) {
    const end = subtreeEnd(idx)
    const next = editing.filter((_, i) => i < idx || i >= end).map((s, i) => ({ ...s, order: i }))
    commit(next)
    setPendingDeleteIdx(null)
    setExpandedSectionIdx((cur) => (cur < idx ? cur : Math.max(0, idx - 1)))
  }

  const hasMultipleSections = editing.length > 1

  return (
    <div className="rounded-2xl flex flex-1 min-h-0" style={{ background: 'var(--card-bg-warm)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--card-shadow)', overflow: 'hidden' }}>

      {/* 左侧：章节目录（仅多章节时显示，可折叠） */}
      {hasMultipleSections && tocOpen && (
        <div className="flex flex-col flex-shrink-0" style={{ width: '200px', borderRight: '1px solid var(--border-subtle)', background: 'var(--parchment-50)' }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: '11px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink-muted)' }}>目录</span>
              <span style={{ fontSize: '10px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.5 }}>{editing.length} 节</span>
            </div>
            <button onClick={() => setTocOpen(false)}
              className="flex items-center justify-center rounded-md transition-all"
              style={{ width: 24, height: 24, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; e.currentTarget.style.color = 'var(--ink)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}>
              <ChevronsUpDown size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {editing.map((s, idx) => {
              const childCount = subtreeEnd(idx) - idx - 1
              const isConfirming = pendingDeleteIdx === idx
              // 确认态：行内替换为确认条（不向下扩展，避免底部节的确认条被滚出可视区）
              if (allowDelete && isConfirming) {
                return (
                  <div key={s.id} className="flex items-center gap-1.5"
                    style={{
                      marginRight: '8px',
                      paddingTop: '6px',
                      paddingBottom: '6px',
                      paddingLeft: `${16 + Math.min(s.depth ?? 0, 2) * 16}px`,
                      paddingRight: '8px',
                      background: 'var(--parchment-50)',
                      borderRadius: '6px',
                    }}>
                    <span style={{ flex: 1, fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', lineHeight: 1.4 }}>
                      {childCount > 0 ? `删除本节及其 ${childCount} 个下级节？` : '删除本节？'}
                    </span>
                    <button onClick={() => deleteSection(idx)}
                      style={{ fontSize: '11px', fontFamily: 'DM Sans', fontWeight: 500, color: '#dc2626', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>
                      删除
                    </button>
                    <button onClick={() => setPendingDeleteIdx(null)}
                      style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>
                      取消
                    </button>
                  </div>
                )
              }
              return (
                <div key={s.id} onClick={() => setExpandedSectionIdx(idx)}
                  className="group relative w-full text-left py-2.5 transition-all"
                  style={{
                    background: expandedSectionIdx === idx ? 'var(--popup-surface)' : 'transparent',
                    cursor: 'pointer',
                    borderLeft: expandedSectionIdx === idx ? '2px solid var(--gold)' : '2px solid transparent',
                    // 按 depth 逐层内缩，最深 clamp 到 2 级（与阅读区标题 depth≥2 的约定对齐）
                    paddingLeft: `${16 + Math.min(s.depth ?? 0, 2) * 16}px`,
                    paddingRight: allowDelete ? '40px' : '16px',
                  }}>
                  <p className="truncate" style={{ fontFamily: 'DM Sans', fontSize: '12px', fontWeight: expandedSectionIdx === idx ? 600 : 400, color: expandedSectionIdx === idx ? 'var(--ink)' : 'var(--ink-muted)', marginBottom: '2px' }}>
                    {s.heading || `章节 ${idx + 1}`}
                  </p>
                  <span style={{ fontFamily: 'DM Sans', fontSize: '10px', color: 'var(--ink-muted)', opacity: 0.6 }}>{s.bodyText.split(/\s+/).filter(Boolean).length} 词</span>
                  {allowDelete && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setPendingDeleteIdx(idx) }}
                      title={childCount > 0 ? `删除本节及其 ${childCount} 个下级节` : '删除本节'}
                      className="opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-md transition-all"
                      style={{ position: 'absolute', top: 8, right: 8, width: 22, height: 22, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-muted)' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      {/* 折叠态展开按钮 */}
      {hasMultipleSections && !tocOpen && (
        <button onClick={() => setTocOpen(true)}
          className="flex-shrink-0 flex items-center justify-center transition-all"
          style={{ width: '32px', background: 'var(--parchment-50)', border: 'none', borderRight: '1px solid var(--border-subtle)', cursor: 'pointer', color: 'var(--ink-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'rgba(196,154,60,0.06)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-muted)'; e.currentTarget.style.background = 'var(--parchment-50)' }}>
          <ChevronsUpDown size={14} style={{ transform: 'rotate(90deg)' }} />
        </button>
      )}

      {/* 右侧：章节内容编辑/预览 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 右侧顶栏：编辑/预览切换 */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          {hasMultipleSections ? (
            <input type="text" value={editing[expandedSectionIdx]?.heading || ''} onChange={(e) => updateSection(expandedSectionIdx, 'heading', e.target.value)}
              placeholder={`章节 ${(expandedSectionIdx ?? 0) + 1}`}
              className="truncate"
              style={{ flex: 1, marginRight: '12px', background: 'transparent', border: '1px solid var(--surface-border)', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink)' }} />
          ) : (
            <span />
          )}
          <div className="flex gap-0.5 p-0.5 rounded-lg flex-shrink-0" style={{ background: 'var(--parchment-50)', border: '1px solid var(--surface-border)' }}>
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
          {expandedSectionIdx != null && editing[expandedSectionIdx] && (() => {
            const s = editing[expandedSectionIdx]
            const idx = expandedSectionIdx
            const hasMarkdown = s.bodyMarkdown !== null
            return (
              <div>
                {hasMarkdown ? (
                  contentView === 'edit' ? (
                    <div>
                      <MarkdownToolbar getTextarea={() => textareaRefs.current[idx]} onUpdate={(val) => handleMarkdownChange(idx, val)} />
                      <textarea
                        ref={(el) => { if (el) { textareaRefs.current[idx] = el; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                        value={s.bodyMarkdown || ''}
                        onChange={(e) => { handleMarkdownChange(idx, e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
                        style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid var(--surface-border)', borderRadius: '8px', padding: '14px 16px', fontSize: '14px', fontFamily: '"JetBrains Mono", "Fira Code", monospace', color: 'var(--ink)', lineHeight: 1.8, resize: 'none', overflow: 'hidden' }} />
                    </div>
                  ) : (
                    <div style={{ background: 'var(--card-bg-warm)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '28px 40px' }}>
                      <MarkdownPreview markdown={s.bodyMarkdown} />
                    </div>
                  )
                ) : (
                  <textarea value={s.bodyText} onChange={(e) => updateSection(idx, 'bodyText', e.target.value)} rows={20}
                    style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid var(--surface-border)', borderRadius: '8px', padding: '12px 14px', fontSize: '14px', fontFamily: '"Lora", Georgia, serif', color: 'var(--ink)', lineHeight: 1.8, resize: 'vertical' }} />
                )}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
