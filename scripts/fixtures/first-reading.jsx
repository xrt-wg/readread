// Local UI fixture only. All application fetches are intercepted; no backend writes.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthStateContext, AuthActionsContext } from '../../src/providers/AuthProvider'
import FirstReadingChoiceModal from '../../src/components/FirstReadingChoiceModal'
import '../../src/index.css'

const params = new URLSearchParams(location.search)
if (params.get('theme') === 'night') document.documentElement.setAttribute('data-theme', 'night')
let handled = 'pending', chosen = null, failures = 0
window.fetch = async (url, options) => {
  const name = String(url).split('/').pop()
  if (name === 'get_first_reading_offer') return Response.json({ status: handled, items: [
    { id: 'fixture-a', title: 'The Art of Paying Attention', intro: '在日常生活里，重新发现那些被我们忽略的细节。', wordCount: 640 },
    { id: 'fixture-b', title: 'A Small Journey into the Unknown', intro: '一次没有计划的出发，和沿途意料之外的收获。', wordCount: 820 },
  ] })
  if (name === 'choose_first_reading_offer') {
    if (params.has('failure') && failures++ === 0) throw new TypeError('fixture offline')
    handled = 'chosen'; chosen ||= JSON.parse(options.body).p_submission_id
    return Response.json({ status: handled, readingId: chosen })
  }
  if (name === 'dismiss_first_reading_offer') { handled = 'dismissed'; return Response.json({ status: handled }) }
  throw new Error('Unexpected network request blocked by isolated fixture')
}
const actions = { refreshAuthState() {} }
function Fixture() {
  const [message, setMessage] = useState('隔离界面验证：未连接线上数据')
  return <AuthStateContext.Provider value={{ userId: 'fixture-user', isAuthenticated: true }}><AuthActionsContext.Provider value={actions}>
    <main style={{ padding: 40 }}><h1>阅读</h1><p role="status">{message}</p><button>添加内容</button></main>
    <FirstReadingChoiceModal ready onOpen={async row => { setMessage(`已打开：${row.id}`); return true }} onChanged={() => {}} onNotice={setMessage} />
  </AuthActionsContext.Provider></AuthStateContext.Provider>
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>)
