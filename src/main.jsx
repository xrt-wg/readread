import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthProvider } from './providers/AuthProvider.jsx'
import { ThemeProvider } from './hooks/useTheme.jsx'
import { migrateLocalStorageArticles } from './store/storage'
import './index.css'

// 空闲时升级旧 localStorage 数据为 Document 模型（避免阻塞首次渲染）
if (typeof requestIdleCallback !== 'undefined') {
  requestIdleCallback(() => migrateLocalStorageArticles(), { timeout: 2000 })
} else {
  setTimeout(() => migrateLocalStorageArticles(), 0)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
