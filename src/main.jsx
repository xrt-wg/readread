import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthProvider } from './providers/AuthProvider.jsx'
import { migrateLocalStorageArticles } from './store/storage'
import './index.css'

// 应用启动时自动升级旧 localStorage 数据为 Document 模型
migrateLocalStorageArticles()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
)
