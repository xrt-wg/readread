import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { getAdminFirstReadingConfig, saveAdminFirstReadingConfig } from '../services/firstReading'
import { isLibraryAccessError } from '../services/errorUtils'
import { useAuth } from '../hooks/useAuth'

export default function FirstReadingAdminPanel() {
  const { refreshAuthState } = useAuth()
  const [config, setConfig] = useState(null)
  const [saved, setSaved] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const alive = useRef(false)
  const running = useRef(false)
  const revision = useRef(0)
  async function load() {
    const current = ++revision.current
    setBusy(true); setError(''); setMessage('')
    try {
      const value = await getAdminFirstReadingConfig()
      if (alive.current && current === revision.current) { setConfig(value); setSaved(value) }
    } catch (failure) {
      if (alive.current && current === revision.current) {
        setError(failure.message || '配置加载失败')
        if (isLibraryAccessError(failure)) refreshAuthState()
      }
    } finally { if (alive.current && current === revision.current) setBusy(false) }
  }
  useEffect(() => {
    alive.current = true
    load()
    return () => { alive.current = false; revision.current++ }
  }, [])
  function change(patch) { setConfig(value => ({ ...value, ...patch })); setMessage(''); setError('') }
  const selected = config ? [config.submissionA, config.submissionB].map(id => config.items.find(item => item.id === id)) : []
  const valid = selected.length === 2 && selected.every(item => item?.available) && config.submissionA !== config.submissionB
  const dirty = config && saved && ['enabled','submissionA','submissionB'].some(key => config[key] !== saved[key])
  async function save() {
    if (running.current || busy || !config) return
    running.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const value = await saveAdminFirstReadingConfig(config)
      if (alive.current) { setConfig(value); setSaved(value); setMessage(value.enabled ? '已保存，首次阅读选文已启用' : '已保存，首次阅读选文已关闭') }
    } catch (failure) {
      if (alive.current) {
        setError(failure.message || '保存失败，请重新加载确认当前配置后重试')
        if (isLibraryAccessError(failure)) refreshAuthState()
      }
    } finally { running.current = false; if (alive.current) setBusy(false) }
  }
  return <section className="rounded-3xl border p-5 sm:p-7" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--border-subtle)' }}>
    <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div><h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>首次阅读选文</h2>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>选择两篇推荐文章，供尚未开始阅读的用户直接选读。</p></div>
      <button type="button" disabled={busy} onClick={load} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm disabled:opacity-50" style={{ borderColor: 'var(--border-subtle)', color: 'var(--ink)' }}><RefreshCw size={15} />重新加载</button>
    </div>
    {error && <p role="alert" className="mb-4 text-sm" style={{ color: 'var(--warning-text)' }}>{error}</p>}
    {message && <p role="status" className="mb-4 text-sm" style={{ color: 'var(--success-text)' }}>{message}</p>}
    {!config ? <p style={{ color: 'var(--ink-muted)' }}>{busy ? '正在加载配置…' : '配置尚未加载，请重试'}</p> : <>
      <div className="grid gap-5 md:grid-cols-2">
        {['submissionA','submissionB'].map((key,index) => <div key={key}>
          <label htmlFor={`first-reading-${key}`} className="block text-sm font-medium mb-2" style={{ color: 'var(--ink)' }}>文章 {index + 1}</label>
          <select id={`first-reading-${key}`} value={config[key] || ''} disabled={busy} onChange={event => change({ [key]: event.target.value || null })}
            className="w-full rounded-xl border p-3 text-sm" style={{ color: 'var(--ink)', background: 'var(--surface-bg)', borderColor: 'var(--border-subtle)' }}>
            <option value="">选择已发布的推荐</option>
            {config.items.map(item => <option key={item.id} value={item.id} disabled={!item.available || config[index ? 'submissionA' : 'submissionB'] === item.id}>
              {item.title}{item.available ? '' : '（当前不可用）'}
            </option>)}
          </select>
          <div className="mt-3 rounded-2xl border p-5" style={{ minHeight: 180, borderColor: 'var(--border-subtle)', background: 'var(--surface-bg)' }}>
            {selected[index] ? <><h3 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 21, color: 'var(--ink)' }}>{selected[index].title}</h3>
              <p className="text-sm leading-6 mt-3" style={{ color: 'var(--ink-muted)' }}>{selected[index].intro}</p>
              <p className="text-xs mt-4" style={{ color: selected[index].available ? 'var(--gold-dark)' : 'var(--warning-text)' }}>{selected[index].available ? `${selected[index].wordCount.toLocaleString()} 词` : '已下架或正文不可用，请更换文章'}</p></>
              : <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>选择后预览卡片</p>}
          </div>
        </div>)}
      </div>
      {!config.items.some(item => item.available) && <p className="mt-4 text-sm" style={{ color: 'var(--ink-muted)' }}>暂无可用文章，请先在推荐管理中发布内容。</p>}
      <div className="mt-6 flex flex-wrap gap-4 items-center justify-between">
        <label className="flex items-center gap-3 text-sm" style={{ color: 'var(--ink)' }}><input type="checkbox" checked={config.enabled} disabled={busy} onChange={event => change({ enabled: event.target.checked })} />启用首次阅读选文</label>
        <button type="button" onClick={save} disabled={busy || !dirty || (config.enabled && !valid)} className="rounded-xl px-5 py-3 text-sm font-medium disabled:opacity-40" style={{ background: 'var(--ink)', color: 'var(--on-ink)' }}>{busy ? '处理中…' : '保存配置'}</button>
      </div>
      {config.enabled && !valid && <p className="mt-3 text-sm" style={{ color: 'var(--warning-text)' }}>启用前需选择两篇不同且正文可用的已发布文章。</p>}
      <p className="mt-4 text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>保存后生效。更换文章不会让已选读或已关闭弹窗的用户再次看到弹窗。</p>
    </>}
  </section>
}
