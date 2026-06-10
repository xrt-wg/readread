import { useEffect, useState } from 'react'
import AdminPage from './components/AdminPage'
import AuthPanel from './components/AuthPanel'
import ImportPage from './components/ImportPage'
import MigrationPanel from './components/MigrationPanel'
import ReaderPage from './components/ReaderPage'
import { saveArticle } from './services/library'
import { useAuth } from './hooks/useAuth'
import { createArticle } from './store/storage'

export default function App() {
  const [article, setArticle] = useState(null)
  const [view, setView] = useState('reader')
  const { canUseCloudLibrary, error, isReady, status, userId } = useAuth()

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

  if (status === 'pending_migration') {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--parchment)' }}>
        {view !== 'admin' ? <AuthPanel onOpenAdmin={() => setView('admin')} /> : null}
        {view === 'admin' ? (
          <AdminPage onExit={() => setView('reader')} />
        ) : (
          <MigrationPanel />
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--parchment)' }}>
      {view !== 'admin' ? <AuthPanel onOpenAdmin={() => setView('admin')} /> : null}
      {view === 'admin' ? (
        <AdminPage onExit={() => setView('reader')} />
      ) : article ? (
        <ReaderPage article={article} onBack={handleBack} />
      ) : (
        <ImportPage onImport={handleImport} onOpen={handleOpen} />
      )}
    </div>
  )
}
