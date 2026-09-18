import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Sun, Moon, Sunset, ChevronUp } from 'lucide-react'
import AuthPanel from './components/AuthPanel'
import { ErrorBoundary } from './components/ErrorBoundary'
import { saveArticle } from './services/library'
import { migrateTrialSnapshot } from './services/migration/firstReadingMigration'
import { getSupabaseClient } from './services/supabase/client'
import { getReading, toReadingDbRow } from './services/readings'
import { useAuth } from './hooks/useAuth'
import { useTheme } from './hooks/useTheme.jsx'

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
  const [fabCollapsed, setFabCollapsed] = useState(false)
  const { canUseCloudLibrary, error, isReady, isAuthenticated, status, userId } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [migration, setMigration] = useState({ userId: null, status: 'pending', error: '' })
  const [migrationRetry, setMigrationRetry] = useState(0)
  const activeUserRef = useRef(userId)
  activeUserRef.current = userId

  useEffect(() => {
    if (!isAuthenticated || !userId) return
    let active = true
    setSilentImporting(true)
    setMigration({ userId, status: 'pending', error: '' })
    // Defer one microtask so StrictMode's discarded effect cannot start a second import.
    Promise.resolve().then(async () => {
      if (!active) return
      try {
        await migrateTrialSnapshot({ storage: window.localStorage, client: getSupabaseClient(), userId, mapReading: toReadingDbRow })
        if (active) setMigration({ userId, status: 'ready', error: '' })
      } catch (failure) {
        if (active) setMigration({ userId, status: 'blocked', error: failure.message || '阅读数据同步失败' })
      } finally {
        if (active) setSilentImporting(false)
      }
    })
    return () => { active = false }
  }, [isAuthenticated, userId, migrationRetry])
  useEffect(() => {
    setArticle(null)
    setView('reader')
    setFabCollapsed(false)
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
    const fullArticle = await getReading(savedArticle.id, { canUseCloudLibrary, userId, signal: AbortSignal.timeout(15000) })
    if (activeUserRef.current !== userId) return false
    if (!fullArticle) return false
    if (!fullArticle.sections?.some(section => section.body?.text?.trim())) throw new Error('文章正文暂不可用')
    setArticle(fullArticle)
    return true
  }

  const handleBack = () => {
    setArticle(null)
    setFabCollapsed(false)
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

  if (isAuthenticated && (silentImporting || migration.userId !== userId || migration.status === 'pending')) {
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
    <div className="canvas">
      <AuthPanel collapsed={view === 'admin' ? false : fabCollapsed} showAdminEntry={view !== 'admin'} onOpenAdmin={() => setView('admin')} triggerOpen={authPanelTrigger} />
      {view !== 'admin' ? (
        <button
          onClick={toggleTheme}
          className="fixed z-50 flex items-center justify-center rounded-full transition-all"
          style={{
            right: '20px',
            bottom: '76px',
            width: '40px',
            height: '40px',
            background: 'var(--popup-bg)',
            border: '1px solid var(--popup-border)',
            boxShadow: 'var(--popup-shadow)',
            color: 'var(--ink-muted)',
            cursor: 'pointer',
            opacity: fabCollapsed ? 0 : 1,
            transform: fabCollapsed ? 'translateY(56px) scale(0.3)' : 'translateY(0) scale(1)',
            pointerEvents: fabCollapsed ? 'none' : 'auto',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--hover-bg)'
            e.currentTarget.style.color = 'var(--ink)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--popup-bg)'
            e.currentTarget.style.color = 'var(--ink-muted)'
          }}
        >
          {theme === 'day-d' ? <Sun size={16} /> : theme === 'night' ? <Moon size={16} /> : <Sunset size={16} />}
        </button>
      ) : null}
      {/* 收起态悬浮球 — 收藏列表弹出时出现，点击展开回按钮组 */}
      {view !== 'admin' ? (
        <button
          onClick={() => setFabCollapsed(false)}
          title="展开工具栏"
          aria-label="展开工具栏"
          className="fixed z-50 flex items-center justify-center rounded-full transition-all"
          style={{
            right: '20px',
            bottom: '20px',
            width: '44px',
            height: '44px',
            background: 'radial-gradient(circle at 30% 28%, var(--popup-surface), var(--popup-bg) 70%)',
            border: '1px solid var(--popup-border)',
            boxShadow: 'var(--popup-shadow)',
            color: 'var(--ink-muted)',
            cursor: 'pointer',
            opacity: fabCollapsed ? 1 : 0,
            transform: fabCollapsed ? 'scale(1)' : 'scale(0.3)',
            pointerEvents: fabCollapsed ? 'auto' : 'none',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ink)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-muted)' }}
        >
          <ChevronUp size={16} />
        </button>
      ) : null}
      {isAuthenticated && migration.status === 'blocked' && migration.userId === userId && (
        <div role="status" style={{ padding: '10px 24px', color: 'var(--ink)', fontSize: 13 }}>
          {migration.error} <button onClick={() => setMigrationRetry(n => n + 1)} style={{ textDecoration: 'underline' }}>重试同步</button>
        </div>
      )}
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          {view === 'admin' ? (
            <AdminPage onExit={() => setView('reader')} />
          ) : article ? (
            <ReaderPage article={article} onBack={handleBack} fabCollapsed={fabCollapsed} onFabCollapsedChange={setFabCollapsed} />
          ) : (
            <div className="tablet">
              <ImportPage key={userId || 'anonymous'} inTablet onImport={handleImport} onOpen={handleOpen} onTriggerAuth={() => setAuthPanelTrigger((v) => v + 1)} firstReadingReady={migration.userId === userId && migration.status === 'ready'} />
            </div>
          )}
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}
