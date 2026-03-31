import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, FileText, ArrowRight, BookOpen, Clock, Trash2, BookMarked, Link, Loader2, Download, FolderOpen, Sparkles, PlusCircle, CheckCircle2 } from 'lucide-react'
import { articleStore, bookmarkStore, exportData, importData, createArticle } from '../store/storage'
import { FEATURED_ARTICLES } from '../data/featuredArticles'
import { fetchArticleFromUrl } from '../services/urlImport'
import { Readability } from '@mozilla/readability'
import { htmlToMarkdown } from '../utils/markdownUtils'

const SAMPLE_TEXT = {
  title: 'The Last Lecture — Randy Pausch',
  text: `We cannot change the cards we are dealt, just how we play the hand.

Experience is what you get when you didn't get what you wanted. And experience is often the most valuable thing you have to offer.

The brick walls are there for a reason. The brick walls are not there to keep us out. The brick walls are there to give us a chance to show how badly we want something. Because the brick walls are there to stop the people who don't want it badly enough. They're there to stop the other people.

When you're screwing up and nobody says anything to you anymore, that means they've given up on you. Your critics are often the ones telling you they still love you and care about you, and want to make you better.

No matter how bad things are, you can always make things worse. At the same time, if you're doing the right things and you maintain your integrity, you can always find a way to survive.

The key question to keep asking is, are you spending your time on the right things? Because time is all you have.

It's not about how to achieve your dreams. It's about how to lead your life. If you lead your life the right way, the karma will take care of itself. The dreams will come to you.`
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export default function ImportPage({ onImport, onOpen }) {
  const [tab, setTab] = useState('featured') // 'featured' | 'url' | 'paste'
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const [articles, setArticles] = useState([])
  const fileInputRef = useRef(null)

  const [markdown, setMarkdown] = useState(null)
  const [urlInput, setUrlInput] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const abortRef = useRef(null)
  const importFileRef = useRef(null)
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => {
    setArticles(articleStore.getAll())
  }, [])

  const handleDelete = (e, id) => {
    e.stopPropagation()
    articleStore.delete(id)
    setArticles(articleStore.getAll())
  }

  const handleExport = useCallback(() => {
    const data = exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `readread-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleImportFile = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!importFileRef.current) return
    importFileRef.current.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        importData(data)
        setArticles(articleStore.getAll())
      } catch (err) {
        alert(err.message || '导入失败，请检查文件格式')
      }
    }
    reader.readAsText(file)
  }, [])

  const handleFile = useCallback((file) => {
    if (!file) return
    const isHtml = file.name.endsWith('.html') || file.name.endsWith('.htm') || file.type === 'text/html'
    const isTxt = file.name.endsWith('.txt') || file.type === 'text/plain'
    if (!isHtml && !isTxt) {
      setError('仅支持 .txt 或 .html 文件')
      return
    }
    setError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target.result
      if (isHtml) {
        try {
          const parser = new DOMParser()
          const doc = parser.parseFromString(content, 'text/html')
          const article = new Readability(doc).parse()
          if (!article?.textContent?.trim()) {
            setError('无法从 HTML 文件中提取正文，请尝试手动粘贴内容')
            return
          }
          setText(article.textContent.trim())
          setTitle(article.title?.trim() || file.name.replace(/\.html?$/i, ''))
          setMarkdown(htmlToMarkdown(article.content ?? ''))
        } catch {
          setError('HTML 文件解析失败，请尝试手动粘贴内容')
        }
      } else {
        setText(content)
        setTitle(file.name.replace(/\.txt$/i, ''))
        setMarkdown(null)
      }
    }
    reader.readAsText(file, 'utf-8')
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    handleFile(file)
  }, [handleFile])

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed) {
      setError('请先输入或上传阅读内容')
      return
    }
    onImport(trimmed, title.trim() || '未命名文章', markdown)
  }

  const handleSample = () => {
    onImport(SAMPLE_TEXT.text, SAMPLE_TEXT.title)
  }

  const handleUrlImport = async () => {
    const url = urlInput.trim()
    if (!url) { setError('请输入文章 URL'); return }
    setError('')
    setUrlLoading(true)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const { title: t, text: tx, markdown: md } = await fetchArticleFromUrl(url, controller.signal)
      if (!controller.signal.aborted) onImport(tx, t, md)
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message ?? '抓取失败')
    } finally {
      if (!controller.signal.aborted) setUrlLoading(false)
    }
  }

  const bookmarkCount = (articleId) => bookmarkStore.getByArticle(articleId).length

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--parchment)' }}>
      {/* Header */}
      <header className="flex justify-center px-6 py-6">
        <div className="flex items-center justify-between w-full" style={{ maxWidth: '840px' }}>
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--ink)' }}
            >
              <BookOpen size={15} aria-hidden="true" style={{ color: 'var(--gold-light)' }} />
            </div>
            <span
              className="font-display font-semibold tracking-tight"
              style={{ fontSize: '20px', color: 'var(--ink)', fontFamily: '"Playfair Display", Georgia, serif' }}
            >
              ReadRead
            </span>
          </div>
          <span
            style={{
              fontSize: '12px',
              color: 'var(--ink-muted)',
              fontFamily: 'DM Sans',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            English Reading · English Learning
          </span>
        </div>
      </header>

      {/* Main content */}
      <main className={`flex-1 flex flex-col items-center ${articles.length > 0 ? 'justify-start pt-10' : 'justify-center pt-0'} px-6 pb-12`}>
        {/* Hero - new users only */}
        {articles.length === 0 && (
          <div className="relative text-center mb-0 w-full" style={{ paddingTop: '96px', paddingBottom: '48px', maxWidth: '840px' }}>
            {/* Radial golden glow from top */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: '700px',
                height: '500px',
                background: 'radial-gradient(ellipse at 50% 0%, rgba(196,154,60,0.13) 0%, rgba(196,154,60,0.03) 55%, transparent 85%)',
                pointerEvents: 'none',
              }}
            />
            {/* Decorative large opening quote */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: '16px',
                left: 'calc(50% - 290px)',
                fontFamily: '"Playfair Display", Georgia, serif',
                fontSize: '220px',
                fontWeight: 700,
                lineHeight: 0.85,
                color: 'var(--gold)',
                opacity: 0.08,
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            >"</div>
            <div className="stagger-children">
              <div className="animate-fade-up">
                <p
                  style={{
                    fontSize: '11.5px',
                    letterSpacing: '0.24em',
                    textTransform: 'uppercase',
                    color: 'var(--gold)',
                    fontFamily: 'DM Sans',
                    fontWeight: 500,
                    marginBottom: '24px',
                  }}
                >
                  你的私人英语阅读空间
                </p>
              </div>
              <div className="animate-fade-up">
                <h1
                  style={{
                    fontFamily: '"Playfair Display", Georgia, serif',
                    fontSize: 'clamp(52px, 6.5vw, 80px)',
                    fontWeight: 800,
                    background: 'linear-gradient(175deg, #1c1917 10%, #3d2b1e 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    lineHeight: 1.04,
                    letterSpacing: '-0.03em',
                  }}
                >
                  读你想读，学你所读
                </h1>
              </div>
              <div className="animate-fade-up">
                <p
                  style={{
                    margin: '28px auto 0',
                    fontSize: 'clamp(15px, 1.4vw, 18px)',
                    color: 'rgba(72, 54, 38, 0.65)',
                    fontFamily: '"Lora", Georgia, serif',
                    fontStyle: 'italic',
                    maxWidth: '520px',
                    lineHeight: 1.8,
                    letterSpacing: '0.012em',
                  }}
                >
                  你的阅读语境是最好的学习土壤
                </p>
              </div>
            </div>

            {/* CTA Row */}
            <div
              className="animate-fade-up flex items-center justify-center gap-3 flex-wrap"
              style={{ marginTop: '36px', animationDelay: '240ms' }}
            >
              <button
                onClick={handleSample}
                aria-label="立即体验示例文章"
                className="flex items-center gap-2 rounded-xl transition-all"
                style={{ background: 'var(--ink)', color: '#fff', border: 'none', padding: '11px 22px', fontSize: '14px', fontFamily: 'DM Sans', fontWeight: 500, cursor: 'pointer', touchAction: 'manipulation', letterSpacing: '0.01em' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#2d2926')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--ink)')}
              >
                <Sparkles size={14} aria-hidden="true" />
                立即体验
              </button>
              <span aria-hidden="true" style={{ fontSize: '13px', color: 'rgba(28,25,23,0.2)', userSelect: 'none' }}>·</span>
              <button
                onClick={() => setImportOpen((o) => !o)}
                className="flex items-center gap-2 rounded-xl transition-all"
                style={{ background: importOpen ? 'rgba(28,25,23,0.07)' : 'transparent', color: 'var(--ink)', border: '1.5px solid rgba(28,25,23,0.18)', padding: '10px 20px', fontSize: '14px', fontFamily: 'DM Sans', fontWeight: 500, cursor: 'pointer', touchAction: 'manipulation' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(28,25,23,0.06)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = importOpen ? 'rgba(28,25,23,0.07)' : 'transparent' }}
              >
                <Upload size={14} aria-hidden="true" />
                {importOpen ? '收起' : '导入文章'}
              </button>
              <span aria-hidden="true" style={{ fontSize: '13px', color: 'rgba(28,25,23,0.2)', userSelect: 'none' }}>·</span>
              <button
                onClick={() => importFileRef.current?.click()}
                aria-label="从备份文件导入"
                className="flex items-center gap-1.5 transition-all"
                style={{ background: 'transparent', border: 'none', color: 'var(--ink-muted)', padding: '10px 4px', fontSize: '13px', fontFamily: 'DM Sans', cursor: 'pointer', touchAction: 'manipulation' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-muted)')}
              >
                <FolderOpen size={13} aria-hidden="true" />
                导入备份
              </button>
              <input ref={importFileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
            </div>
          </div>
        )}

        {/* Library - returning users, shown FIRST */}
        {articles.length > 0 && (
          <div className="w-full mb-8 animate-fade-up" style={{ maxWidth: '640px' }}>
            <div className="flex items-center gap-2 mb-4">
              <BookMarked size={14} aria-hidden="true" style={{ color: 'var(--gold)' }} />
              <span style={{ fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)' }}>
                我的文章库
              </span>
              <span style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.5 }}>
                · {articles.length} 篇
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setImportOpen((o) => !o)}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 transition-all"
                  style={{ background: importOpen ? 'rgba(28,25,23,0.08)' : 'var(--ink)', color: importOpen ? 'var(--ink)' : '#fff', border: 'none', cursor: 'pointer', fontSize: '12px', fontFamily: 'DM Sans', fontWeight: 500 }}
                  onMouseEnter={(e) => { if (!importOpen) e.currentTarget.style.background = '#2d2926' }}
                  onMouseLeave={(e) => { if (!importOpen) e.currentTarget.style.background = 'var(--ink)' }}
                >
                  <PlusCircle size={12} />
                  {importOpen ? '收起' : '导入文章'}
                </button>
                <button onClick={handleExport} title="导出备份" aria-label="导出备份" className="flex items-center justify-center rounded-lg p-1.5 transition-all" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(28,25,23,0.06)'; e.currentTarget.style.color = 'var(--ink)' }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}><Download size={13} /></button>
                <button onClick={() => importFileRef.current?.click()} title="从备份导入" aria-label="从备份导入" className="flex items-center justify-center rounded-lg p-1.5 transition-all" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(28,25,23,0.06)'; e.currentTarget.style.color = 'var(--ink)' }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}><FolderOpen size={13} /></button>
                <input ref={importFileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {articles.map((art) => {
                const bmCount = bookmarkCount(art.id)
                return (
                  <div key={art.id} onClick={() => onOpen(art)} className="group flex items-center justify-between rounded-2xl px-5 py-4 cursor-pointer transition-all" style={{ background: '#ffffff', border: '1px solid rgba(28,25,23,0.07)', boxShadow: '0 1px 4px rgba(28,25,23,0.04)' }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(196,154,60,0.4)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(28,25,23,0.08)' }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(28,25,23,0.07)'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(28,25,23,0.04)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="truncate" style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '15px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>{art.title}</p>
                      <div className="flex items-center gap-3">
                        <span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={11} aria-hidden="true" />{formatDate(art.createdAt)}</span>
                        <span style={{ fontSize: '12px', color: 'rgba(28,25,23,0.2)' }}>·</span>
                        <span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)' }}>{art.wordCount.toLocaleString()} 词</span>
                        {bmCount > 0 && <><span style={{ fontSize: '12px', color: 'rgba(28,25,23,0.2)' }}>·</span><span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--gold-dark)' }}>{bmCount} 条收藏</span></>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button onClick={(e) => handleDelete(e, art.id)} aria-label={`删除《${art.title}》`} className="flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-all" style={{ width: 30, height: 30, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#fee2e2'; e.currentTarget.style.color = '#dc2626' }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}><Trash2 size={13} /></button>
                      <ArrowRight size={15} aria-hidden="true" className="opacity-30 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--gold)' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Import card */}
        {importOpen && (
          <div
            {...(articles.length > 0 ? {
              className: 'fixed inset-0 z-40 flex items-start justify-center overflow-y-auto py-12 px-4',
              style: { background: 'rgba(28,25,23,0.45)', backdropFilter: 'blur(4px)', overscrollBehavior: 'contain' },
              onClick: (e) => e.target === e.currentTarget && setImportOpen(false),
            } : {
              className: 'w-full mt-2 animate-fade-up',
              style: { maxWidth: '640px' },
            })}
          >
            <div
              {...(articles.length > 0 ? { className: 'relative w-full', style: { maxWidth: '640px' } } : {})}
            >
          <div
            className="rounded-3xl p-8"
            style={{
              background: '#ffffff',
              boxShadow: '0 4px 24px rgba(28,25,23,0.08), 0 1px 4px rgba(28,25,23,0.04)',
              border: '1px solid rgba(28,25,23,0.06)',
            }}
          >
            {/* Tab switcher */}
            <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.07)' }}>
              {[{ id: 'featured', icon: Sparkles, label: '精选文章' }, { id: 'url', icon: Link, label: 'URL 导入' }, { id: 'paste', icon: FileText, label: '手动粘贴' }].map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => { setTab(id); setError('') }}
                  className="flex items-center justify-center gap-1.5 flex-1 rounded-lg transition-all"
                  style={{
                    padding: '8px 12px',
                    fontSize: '13px',
                    fontFamily: 'DM Sans',
                    fontWeight: tab === id ? 600 : 400,
                    background: tab === id ? 'rgba(196,154,60,0.11)' : 'transparent',
                    color: tab === id ? 'var(--gold-dark)' : 'var(--ink-muted)',
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: 'none',
                  }}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>

            {/* Featured articles */}
            {tab === 'featured' && (
              <div className="flex flex-col gap-3">
                {FEATURED_ARTICLES.map((fa) => {
                  const alreadyAdded = articles.some((a) => a.title === fa.title)
                  return (
                    <div
                      key={fa.id}
                      className="flex items-start justify-between gap-4 rounded-2xl px-4 py-3"
                      style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.07)' }}
                    >
                      <div className="flex-1 min-w-0">
                        <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '14px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px', lineHeight: 1.3 }}>
                          {fa.title}
                        </p>
                        <p style={{ fontFamily: 'DM Sans', fontSize: '11px', color: 'var(--gold-dark)', marginBottom: '4px', fontWeight: 500, letterSpacing: '0.02em' }}>
                          {fa.source}
                        </p>
                        <p style={{ fontFamily: 'DM Sans', fontSize: '12px', color: 'var(--ink-muted)', lineHeight: 1.5 }}>
                          {fa.description}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          if (alreadyAdded) return
                          const art = createArticle({ title: fa.title, text: fa.text, markdown: fa.markdown ?? null })
                          articleStore.save(art)
                          setArticles(articleStore.getAll())
                          setImportOpen(false)
                        }}
                        disabled={alreadyAdded}
                        className="flex items-center gap-1.5 rounded-xl flex-shrink-0 transition-all"
                        style={{
                          padding: '7px 12px',
                          fontSize: '12px',
                          fontFamily: 'DM Sans',
                          fontWeight: 500,
                          border: 'none',
                          cursor: alreadyAdded ? 'default' : 'pointer',
                          background: alreadyAdded ? 'rgba(52,211,153,0.12)' : 'var(--ink)',
                          color: alreadyAdded ? '#059669' : '#fff',
                          marginTop: '2px',
                        }}
                        onMouseEnter={(e) => { if (!alreadyAdded) e.currentTarget.style.background = '#2d2926' }}
                        onMouseLeave={(e) => { if (!alreadyAdded) e.currentTarget.style.background = 'var(--ink)' }}
                      >
                        {alreadyAdded
                          ? <><CheckCircle2 size={12} /> 已加入</>
                          : <><PlusCircle size={12} /> 加入文章库</>}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* URL import */}
            {tab === 'url' && (
              <div className="mb-5">
                <label htmlFor="url-input" style={{ display: 'block', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '8px' }}>
                  文章链接
                </label>
                <div className="flex gap-2">
                  <input
                    id="url-input"
                    type="url"
                    name="article-url"
                    autoComplete="off"
                    spellCheck={false}
                    value={urlInput}
                    onChange={(e) => { setUrlInput(e.target.value); setError('') }}
                    onKeyDown={(e) => e.key === 'Enter' && !urlLoading && handleUrlImport()}
                    placeholder="https://example.com/blog/article"
                    style={{
                      flex: 1,
                      background: 'var(--parchment-50)',
                      border: '1px solid rgba(28,25,23,0.1)',
                      borderRadius: '10px',
                      padding: '10px 14px',
                      fontSize: '14px',
                      fontFamily: 'DM Sans',
                      color: 'var(--ink)',
                    }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')}
                    onBlur={(e) => (e.target.style.borderColor = 'rgba(28,25,23,0.1)')}
                  />
                  <button
                    onClick={handleUrlImport}
                    disabled={urlLoading}
                    className="flex items-center gap-2 rounded-xl transition-all"
                    style={{
                      padding: '10px 18px',
                      background: urlLoading ? 'rgba(28,25,23,0.4)' : 'var(--ink)',
                      color: '#fff',
                      border: 'none',
                      fontSize: '14px',
                      fontFamily: 'DM Sans',
                      fontWeight: 500,
                      cursor: urlLoading ? 'default' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {urlLoading
                      ? <><Loader2 size={14} className="animate-spin" /> 抓取中…</>
                      : <><ArrowRight size={14} /> 导入</>}
                  </button>
                </div>
                <p style={{ marginTop: '8px', fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.7 }}>
                  支持 Medium、Substack 等公开英文博客
                </p>
              </div>
            )}

            {/* Paste mode fields */}
            {tab === 'paste' && (
              <>
                <div className="mb-5">
                  <label htmlFor="article-title" style={{ display: 'block', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '8px' }}>
                    文章标题（可选）
                  </label>
                  <input
                    id="article-title"
                    type="text"
                    name="article-title"
                    autoComplete="off"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="输入文章标题…"
                    style={{ width: '100%', background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.1)', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)', transition: 'border-color 0.2s' }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')}
                    onBlur={(e) => (e.target.style.borderColor = 'rgba(28,25,23,0.1)')}
                  />
                </div>

                <div className="mb-5">
                  <label htmlFor="article-content" style={{ display: 'block', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '8px' }}>
                    粘贴英文内容
                  </label>
                  <textarea
                    id="article-content"
                    name="article-content"
                    value={text}
                    onChange={(e) => { setText(e.target.value); setError('') }}
                    placeholder="在此粘贴英文文章、段落或任意文本内容…"
                    rows={8}
                    style={{ width: '100%', background: 'var(--parchment-50)', border: `1px solid ${isDragging ? 'var(--gold)' : 'rgba(28,25,23,0.1)'}`, borderRadius: '12px', padding: '14px 16px', fontSize: '14px', fontFamily: '"Lora", Georgia, serif', color: 'var(--ink)', lineHeight: 1.75, resize: 'vertical', transition: 'border-color 0.2s' }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')}
                    onBlur={(e) => (e.target.style.borderColor = 'rgba(28,25,23,0.1)')}
                  />
                </div>

                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-3 cursor-pointer rounded-xl transition-all mb-5"
                  style={{ padding: '14px', border: `1.5px dashed ${isDragging ? 'var(--gold)' : 'rgba(28,25,23,0.15)'}`, background: isDragging ? 'rgba(196,154,60,0.06)' : 'transparent', transition: 'all 0.2s' }}
                >
                  <Upload size={16} style={{ color: isDragging ? 'var(--gold)' : 'var(--ink-muted)' }} />
                  <span style={{ fontSize: '13px', fontFamily: 'DM Sans', color: isDragging ? 'var(--gold)' : 'var(--ink-muted)' }}>
                    拖拽或点击上传 <strong>.txt</strong> 或 <strong>.html</strong> 文件
                  </span>
                  <input ref={fileInputRef} type="file" accept=".txt,.html,.htm,text/plain,text/html" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
                </div>
              </>
            )}

            {/* Error */}
            {error && (
              <p
                className="mb-4"
                style={{ fontSize: '13px', color: '#e05252', fontFamily: 'DM Sans' }}
              >
                {error}
              </p>
            )}

            {/* Actions */}
            {tab === 'paste' && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSubmit}
                  className="flex items-center gap-2.5 rounded-xl transition-all"
                  style={{
                    flex: 1,
                    background: 'var(--ink)',
                    color: '#fff',
                    padding: '13px 20px',
                    fontSize: '14px',
                    fontFamily: 'DM Sans',
                    fontWeight: 500,
                    border: 'none',
                    cursor: 'pointer',
                    justifyContent: 'center',
                    letterSpacing: '0.01em',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#2d2926')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--ink)')}
                >
                  开始阅读
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
          </div>

            </div>
          </div>
        )}

      </main>
    </div>
  )
}
