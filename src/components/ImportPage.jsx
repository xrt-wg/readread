import { useState, useRef, useCallback, useEffect } from 'react'
import { FileText, BookOpen, Clock, Trash2, BookMarked, Download, FolderOpen, Sparkles, PlusCircle, CheckCircle2, GraduationCap, Upload } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  deleteArticle,
  exportLibraryData,
  importLibraryData,
  loadLibrarySnapshot,
} from '../services/library'
import { isLibraryAccessError, resolveLibraryErrorMessage } from '../services/errorUtils'
import { isSupabaseConfigured, listFeaturedArticles } from '../services/supabase'
import { createDocument as createDocumentFromStorage } from '../store/storage'
import { createImportItem, fetchImportItems, countImportReferences, deleteImportItem as deleteImportItemService, copyToReadingZone, updateImportItem } from '../services/importItems'
import ImportItemList from './ImportItemList'
import ImportItemEditor from './ImportItemEditor'
import ImportPanel from './ImportPanel'
import ReviewPanel from './ReviewPanel'

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

function formatCompact(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function calcProgress(article, mark) {
  if (!mark || mark.completed) return null
  if (mark.paragraphIndex === null || mark.paragraphIndex === undefined) return null
  const paragraphs = article.text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0)
  const readWords = paragraphs.slice(0, mark.paragraphIndex + 1).join(' ').split(/\s+/).filter(Boolean).length
  const totalWords = article.wordCount || article.text.split(/\s+/).filter(Boolean).length
  return Math.min(99, Math.round((readWords / totalWords) * 100))
}

const ALL_TABS = [
  { id: 'recommend', label: '推荐', icon: Sparkles },
  { id: 'shelf', label: '书架', icon: FileText },
  { id: 'reading', label: '阅读', icon: BookMarked },
  { id: 'review', label: '回顾', icon: GraduationCap },
  { id: 'import', label: '导入', icon: Upload },
]

export default function ImportPage({ onImport, onOpen, onTriggerAuth }) {
  const { canUseCloudLibrary, isAuthenticated, refreshAuthState, userId } = useAuth()
  const [view, setView] = useState('reading')
  const [error, setError] = useState('')
  const [articles, setArticles] = useState([])
  const [bookmarks, setBookmarks] = useState([])
  const [readingMarks, setReadingMarks] = useState({})
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [featuredArticles, setFeaturedArticles] = useState([])
  const [featuredLoading, setFeaturedLoading] = useState(true)
  const [featuredError, setFeaturedError] = useState('')
  const importFileRef = useRef(null)

  const [importItems, setImportItems] = useState([])
  const [importCounts, setImportCounts] = useState({})
  const [editingItem, setEditingItem] = useState(null)
  const [authGateMessage, setAuthGateMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  function requireAuth(actionLabel) {
    if (!isAuthenticated) {
      setAuthGateMessage(`请先注册/登录后再${actionLabel}`)
      return false
    }
    setAuthGateMessage('')
    return true
  }

  const loadLibraryState = useCallback(async () => {
    const snapshot = await loadLibrarySnapshot({ canUseCloudLibrary, userId })
    setArticles(snapshot.articles)
    setBookmarks(snapshot.bookmarks)
    setReadingMarks(snapshot.readingMarks)
  }, [canUseCloudLibrary, userId])

  const loadImportItems = useCallback(async () => {
    if (!isAuthenticated || !userId) return
    try {
      const items = await fetchImportItems(userId)
      setImportItems(items)
      if (items.length > 0) {
        const counts = {}
        await Promise.all(items.map(async (item) => { counts[item.id] = await countImportReferences(item.id) }))
        setImportCounts(counts)
      }
    } catch (e) { if (isLibraryAccessError(e)) refreshAuthState() }
  }, [isAuthenticated, userId, refreshAuthState])

  const handleImportSuccess = useCallback(() => {
    setSuccessMessage('已保存到书架')
    loadImportItems()
  }, [loadImportItems])

  const handleMoveToReading = useCallback(async (item) => {
    try {
      await copyToReadingZone(item)
      setSuccessMessage('已移入阅读区')
      const newCount = await countImportReferences(item.id)
      setImportCounts((prev) => ({ ...prev, [item.id]: newCount }))
      await loadLibraryState()
    } catch (e) {
      if (isLibraryAccessError(e)) refreshAuthState()
      setError(e.message || '移入阅读区失败')
    }
  }, [loadLibraryState, refreshAuthState])

  const handleDeleteImportItem = useCallback(async (id) => {
    try {
      await deleteImportItemService(id)
      setSuccessMessage('素材已删除')
      setImportItems((prev) => prev.filter((i) => i.id !== id))
    } catch (e) {
      if (isLibraryAccessError(e)) refreshAuthState()
      setError(e.message || '删除失败')
    }
  }, [refreshAuthState])

  const handleSaveImportItem = useCallback(async (id, patch) => {
    await updateImportItem(id, patch)
    setEditingItem(null)
    setSuccessMessage('素材已保存')
    await loadImportItems()
  }, [loadImportItems])

  useEffect(() => { if (isAuthenticated && userId) loadImportItems() }, [isAuthenticated, userId, loadImportItems])

  useEffect(() => {
    let isActive = true
    async function init() {
      try {
        const snapshot = await loadLibrarySnapshot({ canUseCloudLibrary, userId })
        if (!isActive) return
        setArticles(snapshot.articles); setBookmarks(snapshot.bookmarks); setReadingMarks(snapshot.readingMarks)
        setLibraryLoading(false)
      } catch (loadError) {
        if (!isActive) return
        if (isLibraryAccessError(loadError)) refreshAuthState()
        setError(resolveLibraryErrorMessage(loadError, '加载阅读库失败，请稍后重试'))
        setLibraryLoading(false)
      }
    }
    init()
    return () => { isActive = false }
  }, [canUseCloudLibrary, userId])

  useEffect(() => {
    let isActive = true
    async function init() {
      if (!isActive) return
      setFeaturedLoading(true); setFeaturedError('')
      if (!isSupabaseConfigured()) {
        setFeaturedArticles([]); setFeaturedError('当前未配置云端推荐内容服务，推荐阅读暂不可用。'); setFeaturedLoading(false); return
      }
      try {
        const remote = await listFeaturedArticles({ status: 'published' })
        if (!isActive) return
        setFeaturedArticles(remote)
      } catch (loadError) {
        if (!isActive) return
        setFeaturedArticles([]); setFeaturedError(loadError.message || '加载推荐阅读失败')
      } finally { if (isActive) setFeaturedLoading(false) }
    }
    init()
    return () => { isActive = false }
  }, [])

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    try { await deleteArticle(id, { canUseCloudLibrary, userId }); await loadLibraryState() }
    catch (deleteError) {
      if (isLibraryAccessError(deleteError)) refreshAuthState()
      alert(resolveLibraryErrorMessage(deleteError, '删除失败，请稍后重试'))
    }
  }

  const handleExport = useCallback(async () => {
    try {
      const data = await exportLibraryData({ canUseCloudLibrary, userId })
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `readread-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click()
      URL.revokeObjectURL(url)
    } catch (exportError) {
      if (isLibraryAccessError(exportError)) refreshAuthState()
      alert(resolveLibraryErrorMessage(exportError, '导出失败，请稍后重试'))
    }
  }, [canUseCloudLibrary, refreshAuthState, userId])

  const handleImportFile = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!importFileRef.current) return
    importFileRef.current.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        await importLibraryData(data, { canUseCloudLibrary, userId })
        await loadLibraryState()
      } catch (err) {
        if (isLibraryAccessError(err)) refreshAuthState()
        alert(resolveLibraryErrorMessage(err, '导入失败，请检查文件格式'))
      }
    }
    reader.readAsText(file)
  }, [canUseCloudLibrary, loadLibraryState, refreshAuthState, userId])

  const handleSample = async () => {
    try { await onImport(createDocumentFromStorage({ title: SAMPLE_TEXT.title, text: SAMPLE_TEXT.text, format: 'paste' })) }
    catch (sampleError) { setError(sampleError.message || '保存示例文章失败') }
  }

  const bookmarkCount = (articleId) => bookmarks.filter((b) => b.articleId === articleId).length
  const importItemTitleById = (() => {
    const map = {}
    importItems.forEach((item) => { map[item.id] = item.title })
    return map
  })()

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--parchment)' }}>
      {editingItem ? (
        <ImportItemEditor item={editingItem} onSave={handleSaveImportItem} onClose={() => setEditingItem(null)} />
      ) : (
      <>
      {/* Header */}
      <header className="flex justify-center px-6 py-6">
        <div className="flex items-center justify-between w-full" style={{ maxWidth: '840px' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--ink)' }}>
              <BookOpen size={15} aria-hidden="true" style={{ color: 'var(--gold-light)' }} />
            </div>
            <span className="font-display font-semibold tracking-tight" style={{ fontSize: '20px', color: 'var(--ink)', fontFamily: '"Playfair Display", Georgia, serif' }}>ReadRead</span>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--ink-muted)', fontFamily: 'DM Sans', letterSpacing: '0.05em', textTransform: 'uppercase' }}>English Reading · English Learning</span>
        </div>
      </header>

      {/* Success / Auth gate */}
      {successMessage ? (
        <div className="flex items-center justify-between px-6 py-3" style={{ background: 'rgba(52,211,153,0.12)', borderBottom: '1px solid rgba(52,211,153,0.25)' }}>
          <div className="flex items-center gap-2"><CheckCircle2 size={14} style={{ color: '#059669' }} /><span style={{ fontSize: '13px', fontFamily: 'DM Sans', color: '#065f46', fontWeight: 500 }}>{successMessage}</span></div>
          <button onClick={() => setSuccessMessage('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#059669', fontSize: '16px', lineHeight: 1, padding: '2px 6px', borderRadius: '6px' }}>×</button>
        </div>
      ) : null}
      {authGateMessage ? (
        <div className="flex items-center justify-between px-6 py-3" style={{ background: 'rgba(254,243,199,0.92)', borderBottom: '1px solid rgba(217,119,6,0.18)' }}>
          <div className="flex items-center gap-2"><span style={{ fontSize: '13px' }}>🔐</span><span style={{ fontSize: '13px', fontFamily: 'DM Sans', color: '#92400e', fontWeight: 500 }}>{authGateMessage}</span></div>
          <button onClick={() => setAuthGateMessage('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#92400e', fontSize: '16px', lineHeight: 1, padding: '2px 6px', borderRadius: '6px' }}>×</button>
        </div>
      ) : null}

      {/* 5-tab navigation — 仅登录后可见 */}
      {isAuthenticated && (
      <div className="flex justify-center px-3 pt-4 pb-3">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.07)', maxWidth: '560px', width: '100%' }}>
          {ALL_TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => { setView(id); setError('') }}
              className="flex items-center justify-center gap-1.5 flex-1 rounded-lg transition-all"
              style={{ padding: '8px 6px', fontSize: '12px', fontFamily: 'DM Sans', fontWeight: view === id ? 600 : 400, background: view === id ? 'rgba(196,154,60,0.11)' : 'transparent', color: view === id ? 'var(--gold-dark)' : 'var(--ink-muted)', border: 'none', cursor: 'pointer' }}>
              <Icon size={13} />{label}
            </button>
          ))}
        </div>
      </div>
      )}

      <main className="flex-1 flex flex-col items-center px-4 pb-12" style={{ justifyContent: 'flex-start', paddingTop: '8px' }}>
        {/* ═══════ 推荐 ═══════ */}
        {view === 'recommend' && (
          <div className="w-full animate-fade-up" style={{ maxWidth: '640px' }}>
            <div className="rounded-3xl p-8" style={{ background: '#ffffff', boxShadow: '0 4px 24px rgba(28,25,23,0.08), 0 1px 4px rgba(28,25,23,0.04)', border: '1px solid rgba(28,25,23,0.06)' }}>
              <div className="flex items-center gap-2 mb-5">
                <Sparkles size={14} style={{ color: 'var(--gold)' }} />
                <span style={{ fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink)' }}>推荐阅读</span>
              </div>
              {featuredLoading ? (
                <div className="flex items-center gap-2 rounded-2xl px-4 py-4" style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.07)', color: 'var(--ink-muted)' }}>
                  <span style={{ fontSize: '13px', fontFamily: 'DM Sans' }}>正在加载云端推荐内容…</span>
                </div>
              ) : featuredError ? (
                <div className="rounded-2xl px-4 py-4" style={{ background: 'rgba(254,242,242,0.88)', border: '1px solid rgba(239,68,68,0.14)', color: '#b91c1c' }}>
                  <p style={{ fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '4px' }}>推荐阅读暂时不可用</p>
                  <p style={{ fontSize: '12px', fontFamily: 'DM Sans', lineHeight: 1.6 }}>{featuredError}</p>
                </div>
              ) : featuredArticles.length === 0 ? (
                <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.07)', color: 'var(--ink-muted)' }}>
                  <p style={{ fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '4px', color: 'var(--ink)' }}>当前还没有已发布的推荐内容</p>
                  <p style={{ fontSize: '12px', fontFamily: 'DM Sans', lineHeight: 1.6 }}>推荐阅读现在只显示云端已发布内容。</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {featuredArticles.map((fa) => {
                    const alreadyAdded = importItems.some((i) => i.title === fa.title)
                    return (
                      <div key={fa.id} className="flex items-start justify-between gap-4 rounded-2xl px-4 py-3" style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.07)' }}>
                        <div className="flex-1 min-w-0">
                          <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '14px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px', lineHeight: 1.3 }}>{fa.title}</p>
                          <p style={{ fontFamily: 'DM Sans', fontSize: '11px', color: 'var(--gold-dark)', marginBottom: '4px', fontWeight: 500 }}>{fa.source}</p>
                          <p style={{ fontFamily: 'DM Sans', fontSize: '12px', color: 'var(--ink-muted)', lineHeight: 1.5 }}>{fa.description}</p>
                        </div>
                        <button onClick={async () => {
                          if (alreadyAdded) return
                          if (!requireAuth('添加推荐内容')) return
                          try {
                            await createImportItem({
                              meta: { title: fa.title, author: null, format: 'markdown', coverUrl: null, lang: 'auto', sourceUrl: null },
                              sections: [{ heading: null, depth: 0, order: 0, body: { text: fa.text, markdown: fa.markdown ?? null } }]
                            }, { userId, origin: 'featured' })
                            setSuccessMessage('已加入书架')
                            loadImportItems()
                          } catch (saveError) { alert(saveError.message || '添加失败') }
                        }} disabled={alreadyAdded}
                          className="flex items-center gap-1.5 rounded-xl flex-shrink-0 transition-all"
                          style={{ padding: '7px 12px', fontSize: '12px', fontFamily: 'DM Sans', fontWeight: 500, border: 'none', cursor: alreadyAdded ? 'default' : 'pointer', background: alreadyAdded ? 'rgba(52,211,153,0.12)' : 'var(--ink)', color: alreadyAdded ? '#059669' : '#fff', marginTop: '2px' }}>
                          {alreadyAdded ? <><CheckCircle2 size={12} />已加入</> : <><PlusCircle size={12} />加入书架</>}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════ 书架 ═══════ */}
        {view === 'shelf' && (
          <div className="w-full animate-fade-up" style={{ maxWidth: '640px' }}>
            <ImportItemList
              items={importItems}
              importCounts={importCounts}
              onEdit={setEditingItem}
              onMoveToReading={handleMoveToReading}
              onDelete={handleDeleteImportItem}
            />
          </div>
        )}

        {/* ═══════ 阅读 ═══════ */}
        {view === 'reading' && (
          <>
            {libraryLoading ? (
              <div className="text-sm text-stone-500 pt-12" style={{ fontFamily: 'DM Sans' }}>正在加载文章库…</div>
            ) : null}

            {!libraryLoading && articles.length === 0 && (
              <div className="relative text-center mb-0 w-full" style={{ paddingTop: '96px', paddingBottom: '48px', maxWidth: '840px' }}>
                <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '700px', height: '500px', background: 'radial-gradient(ellipse at 50% 0%, rgba(196,154,60,0.13) 0%, rgba(196,154,60,0.03) 55%, transparent 85%)', pointerEvents: 'none' }} />
                <div aria-hidden="true" style={{ position: 'absolute', top: '16px', left: 'calc(50% - 290px)', fontFamily: '"Playfair Display", Georgia, serif', fontSize: '220px', fontWeight: 700, lineHeight: 0.85, color: 'var(--gold)', opacity: 0.08, pointerEvents: 'none', userSelect: 'none' }}>"</div>
                <div className="stagger-children">
                  <div className="animate-fade-up"><p style={{ fontSize: '11.5px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--gold)', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '24px' }}>你的私人英语阅读空间</p></div>
                  <div className="animate-fade-up"><h1 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 'clamp(52px, 6.5vw, 80px)', fontWeight: 800, background: 'linear-gradient(175deg, #1c1917 10%, #3d2b1e 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', lineHeight: 1.04, letterSpacing: '-0.03em' }}>读你想读，学你所读</h1></div>
                  <div className="animate-fade-up"><p style={{ margin: '28px auto 0', fontSize: 'clamp(15px, 1.4vw, 18px)', color: 'rgba(72, 54, 38, 0.65)', fontFamily: '"Lora", Georgia, serif', fontStyle: 'italic', maxWidth: '520px', lineHeight: 1.8, letterSpacing: '0.012em' }}>你的阅读语境是最好的学习土壤</p></div>
                </div>
                <div className="animate-fade-up flex items-center justify-center gap-3 flex-wrap" style={{ marginTop: '36px', animationDelay: '240ms' }}>
                  <button onClick={handleSample} aria-label="立即体验示例文章" className="flex items-center gap-2 rounded-xl transition-all" style={{ background: 'var(--ink)', color: '#fff', border: 'none', padding: '11px 22px', fontSize: '14px', fontFamily: 'DM Sans', fontWeight: 500, cursor: 'pointer', touchAction: 'manipulation', letterSpacing: '0.01em' }} onMouseEnter={(e) => (e.currentTarget.style.background = '#2d2926')} onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--ink)')}><Sparkles size={14} aria-hidden="true" />立即体验</button>
                </div>
              </div>
            )}

            {articles.length > 0 && (
              <div className="w-full mb-8 animate-fade-up" style={{ maxWidth: '640px' }}>
                <div className="flex items-center gap-2 mb-4">
                  <BookMarked size={14} style={{ color: 'var(--gold)' }} />
                  <span style={{ fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)' }}>文章库</span>
                  <span style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.5 }}>· {articles.length} 篇</span>
                  <div className="flex items-center gap-2 ml-auto">
                    <button onClick={() => { if (requireAuth('使用导出功能')) handleExport() }} title="导出备份" aria-label="导出备份" className="flex items-center justify-center rounded-lg p-1.5 transition-all" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(28,25,23,0.06)'; e.currentTarget.style.color = 'var(--ink)' }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}><Download size={13} /></button>
                    <button onClick={() => { if (requireAuth('使用导入功能')) importFileRef.current?.click() }} title="从备份导入" aria-label="从备份导入" className="flex items-center justify-center rounded-lg p-1.5 transition-all" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(28,25,23,0.06)'; e.currentTarget.style.color = 'var(--ink)' }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}><FolderOpen size={13} /></button>
                    <input ref={importFileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
                  </div>
                </div>
                {(() => {
                  const completedCount = Object.values(readingMarks).filter(m => m.completed).length
                  const totalBookmarks = bookmarks.length
                  const wordsRead = articles.filter(a => readingMarks[a.id]?.completed).reduce((sum, a) => sum + (a.wordCount ?? 0), 0)
                  if (completedCount === 0 && totalBookmarks === 0 && wordsRead === 0) return null
                  return (
                    <div className="flex gap-3 mb-4">
                      {[{ label: '已读完', value: completedCount.toLocaleString(), unit: '篇' }, { label: '收藏', value: totalBookmarks.toLocaleString(), unit: '条' }, { label: '累计阅读', value: formatCompact(wordsRead), unit: '词' }].map(({ label, value, unit }) => (
                        <div key={label} style={{ flex: 1, background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(28,25,23,0.07)', borderRadius: '14px', padding: '12px 16px', textAlign: 'center' }}>
                          <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '20px', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1 }}>{value}<span style={{ fontSize: '12px', fontWeight: 400, marginLeft: '3px', color: 'var(--ink-muted)' }}>{unit}</span></div>
                          <div style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', marginTop: '5px', letterSpacing: '0.04em' }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
                <div className="flex flex-col gap-2">
                  {[...articles].sort((a, b) => {
                    const markA = readingMarks[a.id] ?? null; const markB = readingMarks[b.id] ?? null
                    const completedA = markA?.completed ?? false; const completedB = markB?.completed ?? false
                    const progressA = calcProgress(a, markA); const progressB = calcProgress(b, markB)
                    const groupA = completedA ? 2 : progressA !== null ? 1 : 0
                    const groupB = completedB ? 2 : progressB !== null ? 1 : 0
                    if (groupA !== groupB) return groupA - groupB
                    if (groupA === 1) return (progressB ?? 0) - (progressA ?? 0)
                    return 0
                  }).map((art) => {
                    const bmCount = bookmarkCount(art.id)
                    const mark = readingMarks[art.id] ?? null
                    const progress = calcProgress(art, mark)
                    const completed = mark?.completed ?? false
                    return (
                      <div key={art.id} onClick={() => onOpen(art)} className="group flex items-center justify-between rounded-2xl px-5 py-4 cursor-pointer transition-all" style={{ background: '#ffffff', border: '1px solid rgba(28,25,23,0.07)', boxShadow: '0 1px 4px rgba(28,25,23,0.04)' }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(196,154,60,0.4)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(28,25,23,0.08)' }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(28,25,23,0.07)'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(28,25,23,0.04)' }}>
                        <div className="flex-1 min-w-0">
                          <p className="truncate" style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '15px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>{art.title}</p>
                          <div className="flex items-center gap-3">
                            <span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={11} aria-hidden="true" />{formatDate(art.createdAt)}</span>
                            <span style={{ fontSize: '12px', color: 'rgba(28,25,23,0.2)' }}>·</span>
                            <span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)' }}>{art.wordCount.toLocaleString()} 词</span>
                            {bmCount > 0 && <><span style={{ fontSize: '12px', color: 'rgba(28,25,23,0.2)' }}>·</span><span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--gold-dark)' }}>{bmCount} 条收藏</span></>}
                            {art.sectionCount > 1 && <><span style={{ fontSize: '12px', color: 'rgba(28,25,23,0.2)' }}>·</span><span style={{ fontSize: '12px', fontFamily: 'DM Sans' }}>{art.sectionCount} 章</span></>}
                            {art.kind === 'book' && <><span style={{ fontSize: '12px', color: 'rgba(28,25,23,0.2)' }}>·</span><span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: '#0d9488', fontWeight: 500 }}>📖 书</span></>}
                          </div>
                          {art.sourceImportId && importItemTitleById[art.sourceImportId] && (
                            <p style={{ marginTop: '4px', fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)' }}>
                              来源：书架「<button onClick={(e) => { e.stopPropagation(); setView('shelf') }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--gold-dark)', fontFamily: 'DM Sans', fontSize: '11px', fontWeight: 500, padding: 0, textDecoration: 'underline' }}>{importItemTitleById[art.sourceImportId]}</button>」
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <button onClick={(e) => handleDelete(e, art.id)} aria-label={`删除《${art.title}》`} className="flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-all" style={{ width: 30, height: 30, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#fee2e2'; e.currentTarget.style.color = '#dc2626' }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}><Trash2 size={13} /></button>
                          {completed && (<span style={{ fontSize: '11px', fontFamily: 'DM Sans', fontWeight: 500, color: '#16a34a', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '8px', padding: '2px 8px', whiteSpace: 'nowrap' }}>读完</span>)}
                          {!completed && progress !== null && (<span style={{ fontSize: '11px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--gold-dark)', background: 'rgba(196,154,60,0.08)', border: '1px solid rgba(196,154,60,0.2)', borderRadius: '8px', padding: '2px 8px', whiteSpace: 'nowrap' }}>{progress}%</span>)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══════ 回顾 ═══════ */}
        {view === 'review' && (
          <div className="w-full animate-fade-up pt-4">
            {isAuthenticated ? <ReviewPanel /> : (
              <div className="flex flex-col items-center justify-center pt-16 gap-3">
                <GraduationCap size={36} style={{ opacity: 0.25, color: 'var(--ink-muted)' }} />
                <p style={{ fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)', fontWeight: 500 }}>登录后即可使用回顾功能</p>
                <button onClick={() => onTriggerAuth?.()} className="flex items-center gap-2 rounded-xl px-5 py-2.5 transition-all" style={{ background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500 }}>注册/登录</button>
              </div>
            )}
          </div>
        )}

        {/* ═══════ 导入 ═══════ */}
        {view === 'import' && (
          <div className="w-full animate-fade-up pt-2">
            <ImportPanel userId={userId} requireAuth={requireAuth} onImportSuccess={handleImportSuccess} />
          </div>
        )}
      </main>

      {/* ImportItemEditor modal */}
      </>
      )}
    </div>
  )
}
