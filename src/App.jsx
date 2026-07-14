import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import AuthPanel from './components/AuthPanel'
import { ErrorBoundary } from './components/ErrorBoundary'
import { listArticles, saveBookmark, saveReadingMark, setReadingMarkCompleted } from './services/library'
import { getSupabaseClient } from './services/supabase/client'
import { getReading, toReadingDbRow } from './services/readings'
import { useAuth } from './hooks/useAuth'

const AdminPage = lazy(() => import('./components/AdminPage'))
const ImportPage = lazy(() => import('./components/ImportPage'))
const ReaderPage = lazy(() => import('./components/ReaderPage'))

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--parchment)' }}>
      <div className="w-6 h-6 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
// createArticle 已由 storage.js 内部的 createDocument 替代

// MigrationPanel 导入已移除，迁移功能入口已关闭，组件文件保留在磁盘上以备后续需要。

export default function App() {
  const [article, setArticle] = useState(null)
  const [view, setView] = useState('reader')
  const [authPanelTrigger, setAuthPanelTrigger] = useState(0)
  const [silentImporting, setSilentImporting] = useState(false)
  const { canUseCloudLibrary, error, isReady, isAuthenticated, status, userId, refreshAuthState } = useAuth()
  const prevStatusRef = useRef(status)
  const silentImportRunRef = useRef(false)

  // 登录后静默导入 localStorage 中的试用数据到 Supabase
  const runSilentImport = useCallback(async (currentUserId) => {
    if (silentImportRunRef.current) return
    silentImportRunRef.current = true
    setSilentImporting(true)

    const cloudOptions = { canUseCloudLibrary: true, userId: currentUserId }

    try {
      // 仅在 Supabase 为空时才导入，避免覆盖已有云端数据
      const cloudArticles = await listArticles(cloudOptions)
      if (cloudArticles.length > 0) {
        // 云端已有数据，清理本地即可
        window.localStorage.removeItem('rr_articles')
        window.localStorage.removeItem('rr_bookmarks')
        window.localStorage.removeItem('rr_reading_marks')
        window.localStorage.removeItem('rr_local_migration_meta')
        return
      }

      // ── 1. 导入 articles ──
      const rawArticles = window.localStorage.getItem('rr_articles')
      const localArticles = rawArticles ? JSON.parse(rawArticles) : []
      const validArticles = Array.isArray(localArticles)
        ? localArticles.filter((a) => a?.id && a?.title && a?.text).slice(0, 50)
        : []

      const importedArticleIds = new Set()
      // 批量 upsert（替代串行循环，50 次往返 → 1 次）
      if (validArticles.length > 0) {
        const client = getSupabaseClient()
        const rows = validArticles.map(art => toReadingDbRow(art, currentUserId))
        const { error } = await client.from('readings').upsert(rows, {
          onConflict: 'id',
          ignoreDuplicates: false,
        })
        if (!error) {
          validArticles.forEach(art => importedArticleIds.add(art.id))
        }
      }

      // ── 2. 导入 bookmarks（仅导入属于已导入文章的收藏）──
      const rawBookmarks = window.localStorage.getItem('rr_bookmarks')
      const localBookmarks = rawBookmarks ? JSON.parse(rawBookmarks) : []
      const validBookmarks = Array.isArray(localBookmarks)
        ? localBookmarks.filter((b) => b?.id && b?.articleId && b?.text && b?.type && importedArticleIds.has(b.articleId)).slice(0, 200)
        : []

      // 批量 upsert bookmarks
      if (validBookmarks.length > 0) {
        const client = getSupabaseClient()
        const bmRows = validBookmarks.map(bm => ({
          id: bm.id,
          user_id: currentUserId,
          reading_id: bm.articleId,
          type: bm.type,
          text: bm.text,
          translation: bm.translation ?? null,
          translation_provider: bm.translationProvider ?? null,
          context_sentence: bm.contextSentence ?? null,
          context_translation: bm.contextTranslation ?? null,
          translation_status: bm.translationStatus ?? 'pending',
          paragraph_index: bm.paragraphIndex ?? null,
          char_offset: bm.charOffset ?? null,
          review_count: bm.reviewCount ?? 0,
          next_review_at: bm.nextReviewAt ?? null,
          familiarity: bm.familiarity ?? 0,
          section_id: bm.sectionId ?? null,
          section_heading: bm.sectionHeading ?? null,
          deleted_at: null,
        }))
        const { error: bmError } = await client.from('bookmarks').upsert(bmRows, {
          onConflict: 'id',
          ignoreDuplicates: false,
        })
        if (bmError) console.warn('批量导入书签部分失败:', bmError.message)
      }

      // ── 3. 导入 readingMarks ──
      const rawReadingMarks = window.localStorage.getItem('rr_reading_marks')
      const localReadingMarks = rawReadingMarks ? JSON.parse(rawReadingMarks) : {}
      const markEntries = (localReadingMarks && typeof localReadingMarks === 'object')
        ? Object.values(localReadingMarks).filter((m) => m?.articleId && importedArticleIds.has(m.articleId))
        : []

      for (const mark of markEntries) {
        try {
          if (mark.completed) {
            // 先设置阅读位置，再标记完成
            if (mark.paragraphIndex !== null && mark.paragraphIndex !== undefined) {
              await saveReadingMark(mark.articleId, mark.paragraphIndex, cloudOptions)
            }
            await setReadingMarkCompleted(mark.articleId, cloudOptions)
          } else if (mark.paragraphIndex !== null && mark.paragraphIndex !== undefined) {
            await saveReadingMark(mark.articleId, mark.paragraphIndex, cloudOptions)
          }
        } catch (_) { /* 单条失败继续 */ }
      }

      // ── 4. 清理 localStorage ──
      window.localStorage.removeItem('rr_articles')
      window.localStorage.removeItem('rr_bookmarks')
      window.localStorage.removeItem('rr_reading_marks')
      window.localStorage.removeItem('rr_local_migration_meta')
      refreshAuthState()
    } catch (_) {
      // 静默导入失败不阻断用户，保留 localStorage 数据供下次重试
    } finally {
      setSilentImporting(false)
    }
  }, [refreshAuthState])

  useEffect(() => {
    const prevStatus = prevStatusRef.current
    prevStatusRef.current = status

    // 从 anonymous 转为 authenticated 时触发静默导入
    if (prevStatus === 'anonymous' && status === 'authenticated' && userId) {
      runSilentImport(userId)
    }
  }, [status, userId, runSilentImport])

  useEffect(() => {
    setArticle(null)
    setView('reader')
  }, [status, userId])

  const handleImport = async (document) => {
    const savedArticle = await saveArticle(document, {
      canUseCloudLibrary,
      userId,
    })
    setArticle(savedArticle)
  }

  const handleOpen = async (savedArticle) => {
    // 书架列表不含 sections，需补一次详情查询获取正文
    const fullArticle = await getReading(savedArticle.id, { canUseCloudLibrary, userId })
    setArticle(fullArticle || savedArticle)
  }

  const handleBack = () => {
    setArticle(null)
  }

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--parchment)' }}>
        <div className="text-sm text-stone-600">正在初始化账号状态...</div>
      </div>
    )
  }

  if (status === 'error' || status === 'misconfigured') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--parchment)' }}>
        <div className="max-w-md px-6 text-center text-sm text-stone-700">
          {status === 'misconfigured' ? '账号配置缺失，请检查本地环境变量。' : error?.message || '账号状态初始化失败，请刷新后重试。'}
        </div>
      </div>
    )
  }

  if (silentImporting) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--parchment)' }}>
        <div className="text-sm text-stone-600">正在同步阅读数据…</div>
      </div>
    )
  }

  if (status === 'restricted') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--parchment)' }}>
        <div className="max-w-md px-6 text-center text-sm text-stone-700">
          当前账号处于受限状态，暂时无法进入完整业务功能。
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--parchment)' }}>
      {view !== 'admin' ? <AuthPanel onOpenAdmin={() => setView('admin')} triggerOpen={authPanelTrigger} /> : null}
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          {view === 'admin' ? (
            <AdminPage onExit={() => setView('reader')} />
          ) : article ? (
            <ReaderPage article={article} onBack={handleBack} />
          ) : (
            <ImportPage onImport={handleImport} onOpen={handleOpen} onTriggerAuth={() => setAuthPanelTrigger((v) => v + 1)} />
          )}
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}
