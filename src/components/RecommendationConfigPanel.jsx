import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { getRecommendationSubmissionConfig, saveRecommendationSubmissionConfig } from '../services/supabase/recommendationService'
import { isLibraryAccessError } from '../services/errorUtils'
import { useAuth } from '../hooks/useAuth'

export default function RecommendationConfigPanel() {
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
      const value = await getRecommendationSubmissionConfig()
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
  const limitDays = config ? Number(config.submissionLimitDays) : 1
  const valid = Number.isInteger(limitDays) && limitDays >= 1 && limitDays <= 365
  const dirty = config && saved && config.submissionLimitDays !== saved.submissionLimitDays
  function change(value) { setConfig(c => ({ ...c, submissionLimitDays: value })); setMessage(''); setError('') }
  async function save() {
    if (running.current || busy || !config || !valid) return
    running.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const value = await saveRecommendationSubmissionConfig({ limitDays: Number(config.submissionLimitDays), expectedUpdatedAt: config.updatedAt })
      if (alive.current) { setConfig(value); setSaved(value); setMessage(`已保存，每 ${value.submissionLimitDays} 个自然日最多提交 1 篇`) }
    } catch (failure) {
      if (alive.current) {
        setError(failure.message || '保存失败，请重新加载确认当前配置后重试')
        if (isLibraryAccessError(failure)) refreshAuthState()
      }
    } finally { running.current = false; if (alive.current) setBusy(false) }
  }
  return <section className="rounded-3xl border p-5 sm:p-7" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--border-subtle)' }}>
    <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div><h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>推荐提交设置</h2></div>
      <button type="button" disabled={busy} onClick={load} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm disabled:opacity-50" style={{ borderColor: 'var(--border-subtle)', color: 'var(--ink)' }}><RefreshCw size={15} />重新加载</button>
    </div>
    {error && <p role="alert" className="mb-4 text-sm" style={{ color: 'var(--warning-text)' }}>{error}</p>}
    {message && <p role="status" className="mb-4 text-sm" style={{ color: 'var(--success-text)' }}>{message}</p>}
    {!config ? <p style={{ color: 'var(--ink-muted)' }}>{busy ? '正在加载配置…' : '配置尚未加载，请重试'}</p> : <>
      <div className="max-w-sm">
        <label htmlFor="recommendation-submission-limit" className="block text-sm font-medium mb-2" style={{ color: 'var(--ink)' }}>每 N 个自然日最多提交 1 篇</label>
        <input id="recommendation-submission-limit" type="number" min={1} max={365} step={1} value={config.submissionLimitDays} disabled={busy} onChange={event => change(event.target.value)}
          className="w-full rounded-xl border p-3 text-sm" style={{ color: 'var(--ink)', background: 'var(--surface-bg)', borderColor: 'var(--border-subtle)' }} />
      </div>
      <p className="mt-3 text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>自然日按北京时间 0 点重置；被驳回或下架的提交同样占用额度。</p>
      {!valid && <p className="mt-3 text-sm" style={{ color: 'var(--warning-text)' }}>须为 1 至 365 之间的整数。</p>}
      <div className="mt-6 flex items-center gap-4">
        <button type="button" onClick={save} disabled={busy || !dirty || !valid} className="rounded-xl px-5 py-3 text-sm font-medium disabled:opacity-40" style={{ background: 'var(--ink)', color: 'var(--on-ink)' }}>{busy ? '处理中…' : '保存配置'}</button>
      </div>
    </>}
  </section>
}
