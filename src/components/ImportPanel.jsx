import { useState, useRef, useCallback } from 'react'
import { Upload, ArrowRight, Link, Loader2, Clipboard } from 'lucide-react'
import { EXTRACTORS } from '../services/extractors/index'
import { createReading } from '../services/readings'
import { isLibraryAccessError } from '../services/errorUtils'

export default function ImportPanel({ userId, requireAuth, canUseCloudLibrary, onImportSuccess }) {
  const [mode, setMode] = useState('url') // 'url' | 'paste' | 'upload'
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const [markdown, setMarkdown] = useState(null)
  const [fileFormat, setFileFormat] = useState(null)
  const [urlInput, setUrlInput] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const abortRef = useRef(null)
  const fileInputRef = useRef(null)

  const handleClear = useCallback(() => {
    setText(''); setTitle(''); setMarkdown(null); setFileFormat(null); setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleFile = useCallback(async (file) => {
    if (!file) return
    const isHtml = file.name.endsWith('.html') || file.name.endsWith('.htm') || file.type === 'text/html'
    const isMd = file.name.endsWith('.md') || file.name.endsWith('.markdown')
    const isEpub = file.name.endsWith('.epub')
    if (!isHtml && !isMd && !isEpub) { setError('仅支持 .md、.html 或 .epub 文件'); return }
    setError('')
    if (isEpub) {
      if (!requireAuth('导入文章')) return
      const extractor = EXTRACTORS.epub
      if (!extractor) { setError('EPUB 支持即将推出'); return }
      try {
        const buffer = await file.arrayBuffer()
        const result = await extractor({ type: 'buffer', buffer, fileName: file.name, mimeType: file.type || 'application/epub+zip' })
        await createReading(result, { userId, origin: 'imported', canUseCloudLibrary })
        onImportSuccess()
      } catch (e) { setError(e.message || 'EPUB 导入失败') }
      return
    }
    setFileFormat(isHtml ? 'html' : 'markdown')
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target.result
      if (isHtml) {
        try {
          const parser = new DOMParser()
          const doc = parser.parseFromString(content, 'text/html')
          const h1 = doc.querySelector('h1')
          const art = new Readability(doc.cloneNode(true)).parse()
          if (!art?.textContent?.trim()) { setError('无法从 HTML 文件中提取正文'); return }
          setText(art.textContent.trim())
          setTitle(h1?.textContent?.trim() || art.title?.trim() || file.name.replace(/\.html?$/i, ''))
          setMarkdown(content)
        } catch { setError('HTML 文件解析失败') }
      } else {
        setText(content)
        setTitle(file.name.replace(/\.(?:md|markdown)$/i, ''))
        setMarkdown(content)
      }
    }
    reader.readAsText(file, 'utf-8')
  }, [requireAuth, userId, onImportSuccess])

  const handleDrop = useCallback((e) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }, [handleFile])
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = () => setIsDragging(false)

  const handleUrlImport = async () => {
    const url = urlInput.trim()
    if (!url) { setError('请输入文章 URL'); return }
    if (!requireAuth('导入文章')) return
    setError(''); setUrlLoading(true)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await EXTRACTORS.url({ type: 'url', url }, controller.signal)
      if (controller.signal.aborted) return
      await createReading(result, { userId, origin: 'imported', canUseCloudLibrary })
      setUrlInput('')
      onImportSuccess()
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message ?? '抓取失败')
    } finally {
      if (!controller.signal.aborted) setUrlLoading(false)
    }
  }

  const handleSubmit = async () => {
    const trimmed = text.trim()
    if (!trimmed) { setError('请先输入或上传阅读内容'); return }
    if (!requireAuth('导入文章')) return
    try {
      let result
      if (fileFormat && markdown) {
        const extractor = EXTRACTORS[fileFormat]
        if (!extractor) { setError(`${fileFormat} 提取器不可用`); return }
        result = await extractor({ type: 'text', text: markdown, fileName: title || undefined })
      } else {
        result = await EXTRACTORS.paste({ type: 'text', text: trimmed, title: title.trim() || '未命名文章' })
      }
      await createReading(result, { userId, origin: 'imported', canUseCloudLibrary })
      handleClear()
      onImportSuccess()
    } catch (submitError) { setError(submitError.message || '保存文章失败') }
  }

  return (
    <div className="w-full" style={{ maxWidth: '640px', margin: '0 auto' }}>
      {/* Inner tabs: URL / Paste / Upload */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ background: 'var(--parchment-50)', border: '1px solid var(--border-subtle)' }}>
        {[{ id: 'url', icon: Link, label: 'URL 导入' }, { id: 'paste', icon: Clipboard, label: '粘贴' }, { id: 'upload', icon: Upload, label: '上传' }].map(({ id, icon: Icon, label }) => (
          <button key={id} onClick={() => { setMode(id); setError('') }}
            className="flex items-center justify-center gap-1.5 flex-1 rounded-lg transition-all"
            style={{ padding: '8px 12px', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: mode === id ? 600 : 400, background: mode === id ? 'rgba(196,154,60,0.11)' : 'transparent', color: mode === id ? 'var(--gold-dark)' : 'var(--ink-muted)', border: 'none', cursor: 'pointer' }}>
            <Icon size={13} />{label}
          </button>
        ))}
      </div>

      {/* URL import */}
      {mode === 'url' && (
        <div className="mb-5">
          <label htmlFor="url-input-i" style={{ display: 'block', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '8px' }}>文章链接</label>
          <div className="flex gap-2">
            <input id="url-input-i" type="url" autoComplete="off" spellCheck={false} value={urlInput} onChange={(e) => { setUrlInput(e.target.value); setError('') }} onKeyDown={(e) => e.key === 'Enter' && !urlLoading && handleUrlImport()} placeholder="https://example.com/blog/article" style={{ flex: 1, background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)' }} onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')} onBlur={(e) => (e.target.style.borderColor = 'rgba(28,25,23,0.1)')} />
            <button onClick={handleUrlImport} disabled={urlLoading}
              className="flex items-center gap-2 rounded-xl transition-all"
              style={{ padding: '10px 18px', background: urlLoading ? 'rgba(28,25,23,0.4)' : 'var(--ink)', color: urlLoading ? '#fff' : 'var(--on-ink)', border: 'none', fontSize: '14px', fontFamily: 'DM Sans', fontWeight: 500, cursor: urlLoading ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
              {urlLoading ? <><Loader2 size={14} className="animate-spin" />抓取中…</> : <><ArrowRight size={14} />导入</>}
            </button>
          </div>
          <p style={{ marginTop: '8px', fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.7 }}>支持 Medium、Substack 等公开英文博客</p>
        </div>
      )}

      {/* Paste mode */}
      {mode === 'paste' && (
        <>
          <div className="mb-5">
            <label htmlFor="article-title-i" style={{ display: 'block', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '8px' }}>文章标题（可选）</label>
            <input id="article-title-i" type="text" autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="输入文章标题…" style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)', transition: 'border-color 0.2s' }} onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')} onBlur={(e) => (e.target.style.borderColor = 'rgba(28,25,23,0.1)')} />
          </div>
          <div className="mb-5">
            <label htmlFor="article-content-i" style={{ display: 'block', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '8px' }}>粘贴英文内容</label>
            <textarea id="article-content-i" value={text} onChange={(e) => { setText(e.target.value); setError('') }} placeholder="在此粘贴英文文章、段落或任意文本内容…" rows={8} style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '12px', padding: '14px 16px', fontSize: '14px', fontFamily: '"Lora", Georgia, serif', color: 'var(--ink)', lineHeight: 1.75, resize: 'vertical', transition: 'border-color 0.2s' }} onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')} onBlur={(e) => (e.target.style.borderColor = 'rgba(28,25,23,0.1)')} />
          </div>
        </>
      )}

      {/* Upload mode */}
      {mode === 'upload' && (
        <>
          <div onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-3 cursor-pointer rounded-xl transition-all mb-5"
            style={{ padding: '14px', border: `1.5px dashed ${isDragging ? 'var(--gold)' : 'var(--surface-border)'}`, background: isDragging ? 'rgba(196,154,60,0.06)' : 'transparent' }}>
            <Upload size={16} style={{ color: isDragging ? 'var(--gold)' : 'var(--ink-muted)' }} />
            <span style={{ fontSize: '13px', fontFamily: 'DM Sans', color: isDragging ? 'var(--gold)' : 'var(--ink-muted)' }}>拖拽或点击上传 <strong>.md</strong>、<strong>.html</strong> 或 <strong>.epub</strong> 文件</span>
            <input ref={fileInputRef} type="file" accept=".md,.markdown,.html,.htm,.epub,text/html,application/epub+zip" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
          </div>
          {text && (
            <>
              <div className="mb-5">
                <label htmlFor="upload-title-i" style={{ display: 'block', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '8px' }}>文章标题</label>
                <input id="upload-title-i" type="text" autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="输入文章标题…" style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)', transition: 'border-color 0.2s' }} onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')} onBlur={(e) => (e.target.style.borderColor = 'rgba(28,25,23,0.1)')} />
              </div>
              <div className="mb-5">
                <label htmlFor="upload-content-i" style={{ display: 'block', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '8px' }}>内容预览</label>
                <textarea id="upload-content-i" value={text} onChange={(e) => { setText(e.target.value); setError('') }} rows={8} style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '12px', padding: '14px 16px', fontSize: '14px', fontFamily: '"Lora", Georgia, serif', color: 'var(--ink)', lineHeight: 1.75, resize: 'vertical', transition: 'border-color 0.2s' }} onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')} onBlur={(e) => (e.target.style.borderColor = 'rgba(28,25,23,0.1)')} />
              </div>
            </>
          )}
        </>
      )}

      {/* Error */}
      {error && <p className="mb-4" style={{ fontSize: '13px', color: '#e05252', fontFamily: 'DM Sans' }}>{error}</p>}

      {/* Submit for paste / upload modes */}
      {(mode === 'paste' || mode === 'upload') && (
        <div className="flex items-center gap-3">
          {text.trim() && (
            <button onClick={handleClear}
              className="flex items-center gap-2 rounded-xl transition-all"
              style={{ padding: '13px 16px', fontSize: '14px', fontFamily: 'DM Sans', fontWeight: 500, background: 'transparent', color: 'var(--ink-muted)', border: '1px solid var(--surface-border)', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; e.currentTarget.style.color = 'var(--ink)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}>取消</button>
          )}
          <button onClick={handleSubmit}
            className="flex items-center gap-2.5 rounded-xl transition-all"
            style={{ flex: 1, background: 'var(--ink)', color: 'var(--on-ink)', padding: '13px 20px', fontSize: '14px', fontFamily: 'DM Sans', fontWeight: 500, border: 'none', cursor: 'pointer', justifyContent: 'center', letterSpacing: '0.01em' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--btn-hover-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--ink)')}>保存到书架<ArrowRight size={15} /></button>
        </div>
      )}
    </div>
  )
}
