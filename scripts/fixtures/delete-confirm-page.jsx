// Actual ImportPage integration, fake auth context and read-only network fixtures.
// Every fetch is intercepted. Unexpected requests and ALL writes are rejected.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AuthStateContext, AuthActionsContext } from '../../src/providers/AuthProvider'
import '../../src/index.css'

document.documentElement.dataset.theme = 'night'
const rows = [1, 2].map(n => ({ id: `fixture-${n}`, user_id: 'fixture-user', title: `Diagnostic article ${n}`,
  reading_status: 'unread', kind: 'article', total_word_count: 100, created_at: '2026-09-19', origin: 'imported' }))
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const method = init?.method || input?.method || 'GET'
  if (method !== 'GET') throw new Error('Integration fixture blocks all writes')
  const table = url.pathname.split('/').pop()
  if (table === 'readings') return Response.json(url.searchParams.get('reading_status') === 'eq.reading' ? [] : rows)
  if (['bookmarks', 'reading_marks', 'recommendation_submissions'].includes(table)) return Response.json([], { headers: { 'content-range': '0-0/0' } })
  throw new Error(`Unexpected request blocked: ${url.pathname}`)
}
const { default: ImportPage } = await import('../../src/components/ImportPage')
createRoot(document.getElementById('root')).render(<React.StrictMode>
  <AuthStateContext.Provider value={{ userId: 'fixture-user', isAuthenticated: true, canUseCloudLibrary: true }}>
    <AuthActionsContext.Provider value={{ refreshAuthState() {} }}>
      <div className="canvas"><div className="tablet"><ImportPage inTablet onImport={() => {}} onOpen={() => {}} /></div></div>
    </AuthActionsContext.Provider>
  </AuthStateContext.Provider>
</React.StrictMode>)
