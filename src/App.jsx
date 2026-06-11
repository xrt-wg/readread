import { useCallback, useEffect, useRef, useState } from 'react'
import AdminPage from './components/AdminPage'
import AuthPanel from './components/AuthPanel'
import ImportPage from './components/ImportPage'
import ReaderPage from './components/ReaderPage'
import { listArticles, saveArticle } from './services/library'
import { useAuth } from './hooks/useAuth'
import { createArticle } from './store/storage'

// MigrationPanel 导入已移除，迁移功能入口已关闭，组件文件保留在磁盘上以备后续需要。

export default function App() {
  const [article, setArticle] = useState(null)
  const [view, setView] = useState('reader')
  const [authPanelTrigger, setAuthPanelTrigger] = useState(0)
  const { canUseCloudLibrary, error, isReady, isAuthenticated, status, userId, refreshAuthState } = useAuth()
  const prevStatusRef = useRef(status)
  const silentImportRunRef = useRef(false)

  // 登录后静默导入 localStorage 中的试用数据到 Supabase
  const runSilentImport = useCallback(async (currentUserId) => {
    if (silentImportRunRef.current) return
    silentImportRunRef.current = true

    try {
      const rawArticles = window.localStorage.getItem('rr_articles')
      if (!rawArticles) return

      const localArticles = JSON.parse(rawArticles)
      if (!Array.isArray(localArticles) || localArticles.length === 0) return

      // 仅在 Supabase 为空时才导入，避免覆盖已有云端数据
      const cloudArticles = await listArticles({ canUseCloudLibrary: true, userId: currentUserId })
      if (cloudArticles.length > 0) {
        // 云端已有数据，清理本地即可
        window.localStorage.removeItem('rr_articles')
        window.localStorage.removeItem('rr_bookmarks')
        window.localStorage.removeItem('rr_reading_marks')
        window.localStorage.removeItem('rr_local_migration_meta')
        return
      }

      // 设计说明：仅导入 articles，不导入 bookmarks/readingMarks。
      // 原因：匿名用户试用期间，收藏和阅读标记已被功能门控拦截（需登录），
      // 因此 localStorage 中的 rr_bookmarks/rr_reading_marks 即使存在，
      // 也是旧版本（迁移关闭前）遗留的历史数据，不应自动导入。

      // 安全上限：最多导入 50 篇文章，防止极端情况下的长时间阻塞
      const articlesToImport = localArticles.slice(0, 50)
      for (const art of articlesToImport) {
        if (!art?.id || !art?.title || !art?.text) continue
        try {
          await saveArticle(art, { canUseCloudLibrary: true, userId: currentUserId })
        } catch (_) {
          // 单条导入失败不阻断，继续处理下一条
        }
      }

      // 导入完成，清理 localStorage
      window.localStorage.removeItem('rr_articles')
      window.localStorage.removeItem('rr_bookmarks')
      window.localStorage.removeItem('rr_reading_marks')
      window.localStorage.removeItem('rr_local_migration_meta')
      refreshAuthState()
    } catch (_) {
      // 静默导入失败不阻断用户，保留 localStorage 数据供下次重试
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

  const handleImport = async (text, title, markdown = null) => {
    const newArticle = createArticle({ text, title, markdown })
    const savedArticle = await saveArticle(newArticle, {
      canUseCloudLibrary,
      userId,
    })
    setArticle(savedArticle)
  }

  const handleOpen = (savedArticle) => {
    setArticle(savedArticle)
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
      {view === 'admin' ? (
        <AdminPage onExit={() => setView('reader')} />
      ) : article ? (
        <ReaderPage article={article} onBack={handleBack} onTriggerAuth={() => setAuthPanelTrigger((v) => v + 1)} />
      ) : (
        <ImportPage onImport={handleImport} onOpen={handleOpen} />
      )}
    </div>
  )
}
