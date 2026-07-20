import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, BookOpen, Clock, Trash2, BookMarked, Text, Sparkles, CheckCircle2, GraduationCap, Maximize2, Star, Flame, Users, Plus, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  deleteArticle,
  exportLibraryData,
  importLibraryData,
  loadLibrarySnapshot,
} from '../services/library'
import { isLibraryAccessError, resolveLibraryErrorMessage } from '../services/errorUtils'
import { isSupabaseConfigured } from '../services/supabase/client'
import { listRecommendations, addRecommendationToBookshelf } from '../services/supabase/recommendationService'
import { createDocument as createDocumentFromStorage } from '../store/storage'
import { createImportItem, fetchImportItems, updateReading as updateImportItem } from '../services/readings'
import { startReading, returnToShelf, resetReading, deleteReading, listShelfReadings, listReadingZone } from '../services/readings'
import ImportItemList from './ImportItemList'
import ImportItemEditor from './ImportItemEditor'
import ImportPanel from './ImportPanel'
import ReviewPanel from './ReviewPanel'
import SubmitRecommendationModal from './SubmitRecommendationModal'
import RecommendationDetailModal from './RecommendationDetailModal'

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

const SHELF_TABS = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'in_progress', label: '未读完' },
  { id: 'completed', label: '已读完' },
]

const ShelfTabs = memo(function ShelfTabs({ tab, onTab, items }) {
  const counts = useMemo(() => {
    const result = { all: items.length, unread: 0, in_progress: 0, completed: 0 }
    for (const item of items) {
      const status = item.readingStatus || 'unread'
      if (result[status] !== undefined) result[status]++
    }
    return result
  }, [items])

  return (
    <div className="flex items-center gap-1" style={{ fontFamily: 'DM Sans' }}>
      {SHELF_TABS.map(t => (
        <button
          key={t.id}
          onClick={() => onTab(t.id)}
          style={{
            padding: '6px 14px',
            fontSize: '13px',
            fontWeight: tab === t.id ? 600 : 500,
            borderRadius: '8px',
            border: '1px solid transparent',
            background: tab === t.id ? 'var(--hover-bg)' : 'transparent',
            color: tab === t.id ? 'var(--ink)' : 'var(--ink-muted)',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {t.label}
          {counts[t.id] > 0 && (
            <span style={{ marginLeft: '4px', opacity: 0.6, fontSize: '11px' }}>{counts[t.id]}</span>
          )}
        </button>
      ))}
    </div>
  )
})

const ALL_TABS = [
  { id: 'reading', label: '阅读', icon: BookMarked },
  { id: 'review', label: '回顾', icon: GraduationCap },
  { id: 'shelf', label: '书架', icon: FileText },
  { id: 'recommend', label: '推荐', icon: Sparkles },
]

export default function ImportPage({ inTablet, onImport, onOpen, onTriggerAuth }) {
  const { canUseCloudLibrary, isAuthenticated, refreshAuthState, userId } = useAuth()
  const [view, setView] = useState('reading')
  const [error, setError] = useState('')
  const [articles, setArticles] = useState([])
  const [bookmarks, setBookmarks] = useState([])
  const [readingMarks, setReadingMarks] = useState({})
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [recommendations, setRecommendations] = useState([])
  const [recsLoading, setRecsLoading] = useState(true)
  const [recsError, setRecsError] = useState('')
  const importFileRef = useRef(null)

  const [readingZoneItems, setReadingZoneItems] = useState([])  // 阅读区专属：仅 reading_status='reading'
  const [importItems, setImportItems] = useState([])
  const [editingItem, setEditingItem] = useState(null)
  const [authGateMessage, setAuthGateMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [preSelectedItem, setPreSelectedItem] = useState(null)
  const [recommendationCache, setRecommendationCache] = useState({})
  const [selectedRec, setSelectedRec] = useState(null)
  const [shelfTab, setShelfTab] = useState('all')  // 'all' | 'unread' | 'in_progress' | 'completed'
  const [showInlineImport, setShowInlineImport] = useState(false)

  function requireAuth(actionLabel) {
    if (!isAuthenticated) {
      setAuthGateMessage(`请先注册/登录后再${actionLabel}`)
      return false
    }
    setAuthGateMessage('')
    return true
  }

  const loadReadingZone = useCallback(async () => {
    if (!isAuthenticated || !userId) return
    try {
      const items = await listReadingZone({ canUseCloudLibrary, userId })
      setReadingZoneItems(items)
    } catch (e) { if (isLibraryAccessError(e)) refreshAuthState() }
  }, [isAuthenticated, userId, canUseCloudLibrary, refreshAuthState])

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
    } catch (e) { if (isLibraryAccessError(e)) refreshAuthState() }
  }, [isAuthenticated, userId, refreshAuthState])

  const handleImportSuccess = useCallback(() => {
    setSuccessMessage('已保存到书架')
    loadImportItems()
  }, [loadImportItems])

  const handleMoveToReading = useCallback(async (item) => {
    try {
      await startReading(item.id, { canUseCloudLibrary, userId })
      setSuccessMessage('已开始阅读')
      await loadLibraryState()
      await loadReadingZone()
      await loadImportItems()
    } catch (e) {
      if (isLibraryAccessError(e)) refreshAuthState()
      setError(e.message || '开始阅读失败')
    }
  }, [canUseCloudLibrary, loadLibraryState, refreshAuthState])

  const handleStartReading = useCallback(async (reading) => {
    try {
      await startReading(reading.id, { canUseCloudLibrary, userId })
      setSuccessMessage('已开始阅读')
      await loadLibraryState()
      await loadImportItems()
      await loadReadingZone()
    } catch (e) {
      if (isLibraryAccessError(e)) refreshAuthState()
      setError(e.message || '开始阅读失败')
    }
  }, [canUseCloudLibrary, userId, loadLibraryState, loadImportItems, refreshAuthState])

  const handleResetReading = useCallback(async (reading) => {
    if (!confirm('将清除本书的所有书签和阅读进度，确定重新阅读？')) return
    try {
      await resetReading(reading.id, { canUseCloudLibrary, userId })
      setSuccessMessage('已重置，可重新阅读')
      await loadLibraryState()
    } catch (e) {
      if (isLibraryAccessError(e)) refreshAuthState()
      setError(e.message || '重置失败')
    }
  }, [canUseCloudLibrary, userId, loadLibraryState, refreshAuthState])

  const handleDeleteImportItem = useCallback(async (item) => {
    try {
      // 若该 item 来自推荐区，先同步 add_count（非致命，失败不阻塞删除）
      if (
        (item.origin === 'featured' || item.origin === 'featured_legacy') &&
        item.shareSourceId
      ) {
        const { syncAddCountAfterDelete } = await import('../services/supabase')
        syncAddCountAfterDelete(item).catch(() => {})
      }
      await deleteReading(item.id, { canUseCloudLibrary, userId })
      setSuccessMessage('素材已删除')
      setImportItems((prev) => prev.filter((i) => i.id !== item.id))
    } catch (e) {
      if (isLibraryAccessError(e)) refreshAuthState()
      setError(e.message || '删除失败')
    }
  }, [canUseCloudLibrary, userId, refreshAuthState])

  /** 阅读区卡片「放回书架」——未读完放回，状态变为 in_progress */
  const handleReturnToShelfFromList = useCallback(async (reading) => {
    try {
      await returnToShelf(reading.id, { completed: false, canUseCloudLibrary, userId })
      setSuccessMessage('已放回书架')
      await loadLibraryState()
      await loadReadingZone()
      await loadImportItems()
    } catch (e) {
      if (isLibraryAccessError(e)) refreshAuthState()
      setError(e.message || '放回书架失败')
    }
  }, [canUseCloudLibrary, userId, loadLibraryState, loadReadingZone, loadImportItems, refreshAuthState])

  const handleDeleteReading = useCallback(async (reading) => {
    if (reading.readingStatus === 'reading') {
      setError('正在阅读中的内容不可删除，请先放回书架')
      return
    }
    try {
      await deleteReading(reading.id, { canUseCloudLibrary, userId })
      setSuccessMessage('已删除')
      await loadLibraryState()
    } catch (e) {
      if (isLibraryAccessError(e)) refreshAuthState()
      setError(e.message || '删除失败')
    }
  }, [canUseCloudLibrary, userId, loadLibraryState, refreshAuthState])

  const handleSaveImportItem = useCallback(async (id, patch) => {
    await updateImportItem(id, patch)
    setEditingItem(null)
    setSuccessMessage('素材已保存')
    await loadImportItems()
  }, [loadImportItems])

  const handleAddRecommendation = useCallback(async (submission) => {
    if (!requireAuth('添加推荐内容')) return
    try {
      await addRecommendationToBookshelf(submission.id, userId)
      setSuccessMessage('已加入书架')
      loadImportItems()
      // 乐观更新 add_count
      setRecommendations(prev => prev.map(r =>
        r.id === submission.id ? { ...r, addCount: r.addCount + 1 } : r
      ))
    } catch (e) {
      setError(e.message || '添加失败')
    }
  }, [userId, loadImportItems])

  const handleOpenSubmitModal = useCallback((item) => {
    if (!requireAuth('提交推荐')) return
    setPreSelectedItem(item || null)
    setShowSubmitModal(true)
  }, [])

  const handleSubmitSuccess = useCallback(() => {
    setShowSubmitModal(false)
    setPreSelectedItem(null)
    setSuccessMessage('推荐已提交')
    // 刷新推荐列表
    listRecommendations().then(({ items }) => setRecommendations(items)).catch(() => {})
  }, [])

  useEffect(() => { if (isAuthenticated && userId) loadImportItems() }, [isAuthenticated, userId, loadImportItems])

  useEffect(() => {
    let isActive = true
    async function init() {
      try {
        const snapshot = await loadLibrarySnapshot({ canUseCloudLibrary, userId })
        if (!isActive) return
        setArticles(snapshot.articles); setBookmarks(snapshot.bookmarks); setReadingMarks(snapshot.readingMarks)
        // 并行加载阅读区（仅 reading_status='reading' 的条目）
        if (isAuthenticated && userId) {
          try { const zone = await listReadingZone({ canUseCloudLibrary, userId }); if (isActive) setReadingZoneItems(zone) } catch (_) {}
        }
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
  }, [canUseCloudLibrary, userId, isAuthenticated])

  useEffect(() => {
    let isActive = true
    async function init() {
      if (!isActive) return
      setRecsLoading(true); setRecsError('')
      if (!isSupabaseConfigured()) {
        setRecommendations([]); setRecsError('当前未配置云端推荐内容服务，推荐阅读暂不可用。'); setRecsLoading(false); return
      }
      try {
        const { items } = await listRecommendations()
        if (!isActive) return
        setRecommendations(items)
      } catch (loadError) {
        if (!isActive) return
        setRecommendations([]); setRecsError(loadError.message || '加载推荐阅读失败')
      } finally { if (isActive) setRecsLoading(false) }
    }
    init()
    return () => { isActive = false }
  }, [isAuthenticated, userId])

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

  const filteredImportItems = useMemo(() => {
    if (shelfTab === 'unread') return importItems.filter(i => (i.readingStatus || 'unread') === 'unread')
    if (shelfTab === 'in_progress') return importItems.filter(i => i.readingStatus === 'in_progress')
    if (shelfTab === 'completed') return importItems.filter(i => i.readingStatus === 'completed')
    return importItems
  }, [shelfTab, importItems])

  const inTabletMode = inTablet && !editingItem
  const editorBreakout = inTablet && editingItem

  return (
    <div
      className={editorBreakout ? 'fixed inset-0 flex flex-col' : inTabletMode ? 'h-full flex flex-col' : 'min-h-screen flex flex-col'}
      style={inTabletMode ? {} : { backgroundColor: 'var(--parchment)', zIndex: editorBreakout ? 100 : undefined }}
    >
      {editingItem ? (
        <ImportItemEditor item={editingItem} canUseCloudLibrary={canUseCloudLibrary} userId={userId} onSave={handleSaveImportItem} onClose={() => setEditingItem(null)} />
      ) : (
      <>
      {/* Header */}
      {isAuthenticated ? (
        <header className="flex justify-center px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center justify-between w-full" style={{ maxWidth: '640px' }}>
            {/* Stats pill */}
            {(() => {
              const completedCount = Object.values(readingMarks).filter(m => m.completed).length
              const bookmarkCountTotal = bookmarks.length
              const wordsRead = articles.filter(a => readingMarks[a.id]?.completed).reduce((sum, a) => sum + (a.wordCount ?? 0), 0)
              return (
                <div style={{
                  display: 'flex', alignItems: 'baseline', gap: '12px',
                  padding: '5px 14px',
                  background: 'var(--surface-bg)',
                  borderRadius: '10px',
                  border: '1px solid var(--surface-border)',
                  boxShadow: 'none',
                  fontSize: '14px',
                  fontFamily: 'DM Sans',
                }}>
                  <span style={{ color: 'var(--teal)' }}><strong style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '20px', fontWeight: 700 }}>{completedCount}</strong>篇已读</span>
                  <span style={{ color: 'var(--meta-sep-color)', fontWeight: 300 }}>|</span>
                  <span style={{ color: 'var(--gold-dark)' }}><strong style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '20px', fontWeight: 700 }}>{bookmarkCountTotal}</strong>条收藏</span>
                  <span style={{ color: 'var(--meta-sep-color)', fontWeight: 300 }}>|</span>
                  <span style={{ color: 'var(--ink)' }}><strong style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '20px', fontWeight: 700 }}>{formatCompact(wordsRead)}</strong>词累计</span>
                </div>
              )
            })()}
            {/* Icon-only tabs */}
            <div className="flex items-center gap-0.5" style={{ padding: '2px' }}>
              {ALL_TABS.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { setView(id); setError('') }}
                  title={ALL_TABS.find(t => t.id === id)?.label}
                  style={{
                    width: 32, height: 32,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: view === id ? 'var(--surface-bg)' : 'transparent',
                    border: view === id ? '1px solid var(--border-subtle)' : '1px solid transparent',
                    borderRadius: '8px',
                    color: view === id ? 'var(--ink)' : 'var(--ink-muted)',
                    cursor: 'pointer',
                    fontWeight: view === id ? 600 : 400,
                    boxShadow: view === id ? 'var(--card-shadow-hover)' : 'none',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (view !== id) {
                      e.currentTarget.style.background = 'var(--hover-bg)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (view !== id) {
                      e.currentTarget.style.background = 'transparent'
                    }
                  }}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
          </div>
        </header>
      ) : (
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
      )}

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

      {/* safe center：内容少时垂直居中上浮，内容超出视口时自动回退为顶部对齐（不支持的老浏览器同样回退） */}
      <main
        className="flex-1 flex flex-col items-center px-4"
        style={{
          justifyContent: inTabletMode ? 'flex-start' : 'safe center',
          paddingTop: inTabletMode ? '20px' : 'clamp(24px, 5vh, 64px)',
          paddingBottom: inTabletMode ? 'clamp(48px, 9vh, 108px)' : 'clamp(48px, 9vh, 108px)',
          overflowY: inTabletMode ? 'auto' : undefined,
        }}
      >
        {/* ═══════ 推荐 ═══════ */}
        {view === 'recommend' && (
          <div className="w-full animate-fade-up" style={{ maxWidth: '640px' }}>
              {recsLoading ? (
                <div className="flex items-center gap-2 rounded-2xl px-4 py-4" style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.07)', color: 'var(--ink-muted)' }}>
                  <span style={{ fontSize: '13px', fontFamily: 'DM Sans' }}>正在加载推荐内容…</span>
                </div>
              ) : recsError ? (
                <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--danger-bg)', border: '1px solid rgba(239,68,68,0.14)', color: 'var(--danger-text)' }}>
                  <p style={{ fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '4px' }}>推荐阅读暂时不可用</p>
                  <p style={{ fontSize: '12px', fontFamily: 'DM Sans', lineHeight: 1.6 }}>{recsError}</p>
                </div>
              ) : recommendations.length === 0 ? (
                <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.07)', color: 'var(--ink-muted)' }}>
                  <p style={{ fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '4px', color: 'var(--ink)' }}>还没有推荐内容</p>
                  <p style={{ fontSize: '12px', fontFamily: 'DM Sans', lineHeight: 1.6 }}>成为第一个推荐者——导入文章、读完它、提交推荐。</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {recommendations.map((rec) => {
                    const alreadyAdded = importItems.some((i) => i.shareSourceId === rec.id)
                    return (
                      <div key={rec.id}
                        style={{
                          background: 'var(--card-bg-warm)', borderRadius: '20px',
                          border: '1px solid var(--border-subtle)',
                          boxShadow: 'var(--card-shadow)',
                          transition: 'box-shadow 0.3s ease, border-color 0.3s ease, transform 0.3s ease',
                          position: 'relative',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'rgba(196,154,60,0.25)'
                          e.currentTarget.style.boxShadow = 'var(--card-shadow-hover), 0 0 0 1px rgba(196,154,60,0.12)'
                          e.currentTarget.style.transform = 'translateY(-1px)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'var(--border-subtle)'
                          e.currentTarget.style.boxShadow = 'none'
                          e.currentTarget.style.transform = ''
                        }}
                      >
                        <div style={{ padding: '20px 22px', position: 'relative' }}>

                          {/* 右上角详情按钮 */}
                          <button
                            onClick={() => setSelectedRec(rec)}
                            title="查看详情"
                            style={{
                              position: 'absolute', top: '20px', right: '22px',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: '30px', height: '30px', padding: 0,
                              color: 'var(--ink-muted)', background: 'transparent',
                              border: '1px solid var(--surface-border)', borderRadius: '9px',
                              cursor: 'pointer', zIndex: 1,
                              transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--hover-bg)'
                              e.currentTarget.style.color = 'var(--ink)'
                              e.currentTarget.style.borderColor = 'var(--surface-border)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'transparent'
                              e.currentTarget.style.color = 'var(--ink-muted)'
                              e.currentTarget.style.borderColor = 'var(--surface-border)'
                            }}
                          >
                            <Maximize2 size={13} />
                          </button>

                          {/* 标题 */}
                          <p style={{
                            fontFamily: '"Playfair Display", Georgia, serif',
                            fontSize: '18px', fontWeight: 700, color: 'var(--ink)',
                            lineHeight: 1.25, letterSpacing: '-0.015em',
                            marginBottom: rec.intro ? '10px' : '6px',
                            paddingRight: '44px',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{rec.title}</p>

                          {/* 介绍 */}
                          {rec.intro && (
                            <p style={{
                              fontFamily: 'DM Sans', fontSize: '12px',
                              color: 'var(--ink-light)', lineHeight: 1.65,
                              marginTop: '10px',
                              paddingLeft: '10px', paddingRight: '44px',
                              borderLeft: '2.5px solid rgba(196,154,60,0.22)',
                            }}>{rec.intro}</p>
                          )}

                          {/* 底部栏 */}
                          <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            gap: '12px', marginTop: '10px', paddingTop: '10px',
                            borderTop: '1px solid var(--border-subtle)',
                          }}>
                            {/* 左侧：评分 + 人数 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                              <span title="推荐值" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ display: 'flex', alignItems: 'center', opacity: 0.7, color: 'var(--gold-dark)' }}>
                                  <Flame size={13} />
                                </span>
                                <span style={{ fontFamily: 'DM Sans', fontSize: '13px', fontWeight: 700, color: 'var(--gold-dark)', letterSpacing: '-0.01em' }}>
                                  {rec.recommendScore}
                                </span>
                              </span>
                              <span title="添加人数" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ display: 'flex', alignItems: 'center', opacity: 0.55, color: 'var(--ink-muted)' }}>
                                  <Users size={13} />
                                </span>
                                <span style={{ fontFamily: 'DM Sans', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
                                  {rec.addCount}
                                </span>
                              </span>
                            </div>

                            {/* 右侧：加入按钮 */}
                            <button
                              onClick={() => handleAddRecommendation(rec)}
                              disabled={alreadyAdded}
                              title={alreadyAdded ? '已加入书架' : '加入书架'}
                              style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                width: '30px', height: '30px', padding: 0,
                                border: 'none', borderRadius: '9px',
                                cursor: alreadyAdded ? 'default' : 'pointer',
                                background: alreadyAdded ? 'rgba(52,211,153,0.10)' : 'var(--ink)',
                                color: alreadyAdded ? '#059669' : 'var(--on-ink)',
                                transition: 'all 0.2s ease',
                              }}
                              onMouseEnter={(e) => {
                                if (!alreadyAdded) e.currentTarget.style.background = 'var(--btn-hover-bg)'
                              }}
                              onMouseLeave={(e) => {
                                if (!alreadyAdded) e.currentTarget.style.background = 'var(--ink)'
                              }}
                            >
                              {alreadyAdded ? <Check size={13} /> : <Plus size={13} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
          </div>
        )}

        {/* ═══════ 书架 ═══════ */}
        {view === 'shelf' && (
          <div className="w-full animate-fade-up" style={{ maxWidth: '640px' }}>
            {/* 空书架：直接展示导入面板 */}
            {importItems.length === 0 ? (
              <div className="rounded-3xl p-8" style={{ background: 'var(--card-bg-warm)', boxShadow: 'var(--card-shadow)', border: '1px solid var(--border-subtle)' }}>
                <div className="text-center mb-8">
                  <FileText size={32} style={{ opacity: 0.2, color: 'var(--ink-muted)', marginBottom: '12px' }} />
                  <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '18px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}>书架为空</p>
                  <p style={{ fontSize: '13px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', lineHeight: 1.6 }}>导入你的第一篇英文内容，开始策展</p>
                </div>
                <ImportPanel userId={userId} requireAuth={requireAuth} canUseCloudLibrary={canUseCloudLibrary} onImportSuccess={handleImportSuccess} />
              </div>
            ) : (
              <>
                {/* Control bar: ShelfTabs (left) + 2 icon buttons (right) */}
                <div className="flex items-center justify-between mb-3">
                  <ShelfTabs tab={shelfTab} onTab={setShelfTab} items={importItems} />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setShowInlineImport(v => !v)}
                      title="导入新内容"
                      style={{
                        width: 34, height: 34,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'transparent',
                        border: '1px solid transparent',
                        borderRadius: '8px',
                        color: showInlineImport ? 'var(--ink)' : 'var(--ink-muted)',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(28,25,23,0.06)'
                        e.currentTarget.style.borderColor = 'rgba(28,25,23,0.12)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.borderColor = 'transparent'
                      }}
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      onClick={() => handleOpenSubmitModal(null)}
                      title="提交推荐"
                      style={{
                        width: 34, height: 34,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'transparent',
                        border: '1px solid transparent',
                        borderRadius: '8px',
                        color: 'var(--ink-muted)',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(28,25,23,0.06)'
                        e.currentTarget.style.borderColor = 'rgba(28,25,23,0.12)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.borderColor = 'transparent'
                      }}
                    >
                      <Sparkles size={16} />
                    </button>
                  </div>
                </div>

                {/* 可折叠导入面板 */}
                {showInlineImport && (
                  <div className="rounded-3xl p-6 mb-4 animate-fade-up" style={{ background: 'var(--card-bg-warm)', boxShadow: 'var(--card-shadow)', border: '1px solid var(--border-subtle)' }}>
                    <ImportPanel userId={userId} requireAuth={requireAuth} canUseCloudLibrary={canUseCloudLibrary} onImportSuccess={() => { handleImportSuccess(); setShowInlineImport(false) }} />
                  </div>
                )}

                {/* 条目列表 */}
                <ImportItemList
                  items={filteredImportItems}
                  readingMarks={readingMarks}
                  activeFilter={shelfTab}
                  onEdit={setEditingItem}
                  onMoveToReading={handleMoveToReading}
                  onDelete={handleDeleteImportItem}
                  onReset={handleResetReading}
                />
              </>
            )}
          </div>
        )}

        {/* ═══════ 阅读 ═══════ */}
        {view === 'reading' && (
          <>
            {libraryLoading ? (
              <div className="text-sm text-stone-500 pt-12" style={{ fontFamily: 'DM Sans' }}>正在加载文章库…</div>
            ) : null}

            {!libraryLoading && readingZoneItems.length === 0 && (
              <div className="relative text-center mb-0 w-full" style={{ paddingTop: '96px', paddingBottom: '48px', maxWidth: '840px' }}>
                <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '700px', height: '500px', background: 'radial-gradient(ellipse at 50% 0%, rgba(196,154,60,0.13) 0%, rgba(196,154,60,0.03) 55%, transparent 85%)', pointerEvents: 'none' }} />
                <div aria-hidden="true" style={{ position: 'absolute', top: '16px', left: 'calc(50% - 290px)', fontFamily: '"Playfair Display", Georgia, serif', fontSize: '220px', fontWeight: 700, lineHeight: 0.85, color: 'var(--gold)', opacity: 0.08, pointerEvents: 'none', userSelect: 'none' }}>"</div>
                <div className="stagger-children">
                  <div className="animate-fade-up"><p style={{ fontSize: '11.5px', letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--gold)', fontFamily: 'DM Sans', fontWeight: 500, marginBottom: '24px' }}>你的私人英语阅读空间</p></div>
                  <div className="animate-fade-up"><h1 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 'clamp(52px, 6.5vw, 80px)', fontWeight: 800, background: 'linear-gradient(175deg, var(--ink) 10%, var(--ink-light) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', lineHeight: 1.04, letterSpacing: '-0.03em' }}>读你想读，学你所读</h1></div>
                  <div className="animate-fade-up"><p style={{ margin: '28px auto 0', fontSize: 'clamp(15px, 1.4vw, 18px)', color: 'var(--ink-muted)', fontFamily: '"Lora", Georgia, serif', fontStyle: 'italic', maxWidth: '520px', lineHeight: 1.8, letterSpacing: '0.012em' }}>你的阅读语境是最好的学习土壤</p></div>
                </div>
                <div className="animate-fade-up flex items-center justify-center gap-3 flex-wrap" style={{ marginTop: '36px', animationDelay: '240ms' }}>
                  <button onClick={handleSample} aria-label="立即体验示例文章" className="flex items-center gap-2 rounded-xl transition-all" style={{ background: 'var(--ink)', color: '#fff', border: 'none', padding: '11px 22px', fontSize: '14px', fontFamily: 'DM Sans', fontWeight: 500, cursor: 'pointer', touchAction: 'manipulation', letterSpacing: '0.01em' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--btn-hover-bg)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--ink)')}><Sparkles size={14} aria-hidden="true" />立即体验</button>
                </div>
              </div>
            )}

            {readingZoneItems.length > 0 && (
              <div className="w-full mb-8 animate-fade-up" style={{ maxWidth: '640px' }}>
                <div className="flex flex-col gap-2">
                  {[...readingZoneItems].sort((a, b) => {
                    const markA = readingMarks[a.id] ?? null; const markB = readingMarks[b.id] ?? null
                    const completedA = markA?.completed ?? false; const completedB = markB?.completed ?? false
                    const progressA = markA?.progressPercent ?? null; const progressB = markB?.progressPercent ?? null
                    const groupA = completedA ? 2 : progressA !== null ? 1 : 0
                    const groupB = completedB ? 2 : progressB !== null ? 1 : 0
                    if (groupA !== groupB) return groupA - groupB
                    if (groupA === 1) return (progressB ?? 0) - (progressA ?? 0)
                    return 0
                  }).map((art) => {
                    const bmCount = bookmarkCount(art.id)
                    const mark = readingMarks[art.id] ?? null
                    const progress = mark?.progressPercent ?? null
                    const completed = mark?.completed ?? false
                    return (
                      <div key={art.id} onClick={() => onOpen(art)} className="group flex items-center justify-between rounded-2xl px-5 py-4 cursor-pointer transition-all" style={{ background: 'var(--card-bg-warm)', border: '1px solid var(--border-subtle)', boxShadow: 'none' }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(196,154,60,0.4)'; e.currentTarget.style.boxShadow = 'var(--card-shadow-hover)' }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.boxShadow = 'none' }}>
                        <div className="flex-1 min-w-0">
                          <p className="truncate" style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '15px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>{art.title}</p>
                          <div className="flex items-center gap-2">
                            <span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={11} aria-hidden="true" />{formatDate(art.createdAt)}</span>
                            <span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--meta-sep-color)' }}>|</span>
                            <span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Text size={11} aria-hidden="true" />{(art.wordCount || 0).toLocaleString()}</span>
                            {bmCount > 0 && (
                              <>
                                <span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--meta-sep-color)' }}>|</span>
                                <span style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Star size={11} aria-hidden="true" />{bmCount}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <button onClick={(e) => { e.stopPropagation(); handleReturnToShelfFromList(art) }} aria-label={`将《${art.title}》放回书架`} title="放回书架" className="flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-all" style={{ width: 30, height: 30, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196,154,60,0.1)'; e.currentTarget.style.color = 'var(--gold-dark)' }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}><BookOpen size={13} /></button>
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
          <div className="w-full animate-fade-up pt-0">
            {isAuthenticated ? <ReviewPanel /> : (
              <div className="flex flex-col items-center justify-center pt-16 gap-3">
                <GraduationCap size={36} style={{ opacity: 0.25, color: 'var(--ink-muted)' }} />
                <p style={{ fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink)', fontWeight: 500 }}>登录后即可使用回顾功能</p>
                <button onClick={() => onTriggerAuth?.()} className="flex items-center gap-2 rounded-xl px-5 py-2.5 transition-all" style={{ background: 'var(--ink)', color: 'var(--on-ink)', border: 'none', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500 }}>注册/登录</button>
              </div>
            )}
          </div>
        )}

      </main>

      {/* 地脚：品牌收束，给页面一个视觉终点 */}
      <footer className="flex items-center justify-center gap-2 px-6 py-5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <span style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>ReadRead</span>
        <span style={{ color: 'var(--meta-sep-color)', fontSize: '12px' }}>·</span>
        <span style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', letterSpacing: '0.08em' }}>读你想读，学你所读</span>
      </footer>

      {/* ImportItemEditor modal */}
      </>
      )}

      {/* SubmitRecommendationModal */}
      {showSubmitModal && (
        <SubmitRecommendationModal
          userId={userId}
          importItems={importItems}
          preSelectedId={preSelectedItem?.id || null}
          onClose={() => { setShowSubmitModal(false); setPreSelectedItem(null) }}
          onSubmitted={handleSubmitSuccess}
          generationCache={recommendationCache}
          onCacheUpdate={setRecommendationCache}
        />
      )}

      {/* RecommendationDetailModal */}
      {selectedRec && (
        <RecommendationDetailModal
          rec={selectedRec}
          onClose={() => setSelectedRec(null)}
        />
      )}
    </div>
  )
}
