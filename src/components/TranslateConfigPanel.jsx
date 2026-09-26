import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { getTranslateRateLimitConfig, saveTranslateRateLimitConfig } from '../services/supabase/translateConfigService'
import { isLibraryAccessError } from '../services/errorUtils'
import { useAuth } from '../hooks/useAuth'

export default function TranslateConfigPanel() {
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
      const value = await getTranslateRateLimitConfig()
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

  const keys = ['llmPerUserLimit', 'llmWindowHours', 'directPerIpLimit', 'directWindowHours']
  const asNum = (v) => Number(v)
  const valid = config && keys.every((k) => Number.isInteger(asNum(config[k])) && asNum(config[k]) >= 1)
  const dirty = config && saved && keys.some((k) => config[k] !== saved[k])

  function change(key, value) { setConfig((c) => ({ ...c, [key]: value })); setMessage(''); setError('') }

  async function save() {
    if (running.current || busy || !config || !valid || !dirty) return
    running.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const value = await saveTranslateRateLimitConfig({
        llmPerUserLimit: asNum(config.llmPerUserLimit),
        llmWindowHours: asNum(config.llmWindowHours),
        directPerIpLimit: asNum(config.directPerIpLimit),
        directWindowHours: asNum(config.directWindowHours),
        expectedUpdatedAt: config.updatedAt,
      })
      if (alive.current) { setConfig(value); setSaved(value); setMessage('已保存，阈值即时生效（无需重新部署）') }
    } catch (failure) {
      if (alive.current) {
        setError(failure.message || '保存失败，请重新加载确认当前配置后重试')
        if (isLibraryAccessError(failure)) refreshAuthState()
      }
    } finally { running.current = false; if (alive.current) setBusy(false) }
  }

  function field(id, label, hint, key) {
    return (
      <div key={key}>
        <label htmlFor={id} className="mb-2 block text-sm font-medium" style={{ color: 'var(--ink)' }}>{label}</label>
        <input
          id={id}
          type="number"
          min={1}
          step={1}
          value={config ? config[key] : ''}
          disabled={busy}
          onChange={(event) => change(key, event.target.value)}
          className="w-full rounded-xl border p-3 text-sm"
          style={{ color: 'var(--ink)', background: 'var(--surface-bg)', borderColor: 'var(--border-subtle)' }}
        />
        {hint ? <p className="mt-1 text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>{hint}</p> : null}
      </div>
    )
  }

  return (
    <section className="rounded-3xl border p-5 sm:p-7" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--border-subtle)' }}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>翻译限流设置</h2>
          <p className="mt-2 text-sm leading-6" style={{ color: 'var(--ink-muted)' }}>控制翻译接口调用频率：LLM 精译按用户（sub）、划词直译按 IP 限流；修改后即时生效。</p>
        </div>
        <button type="button" disabled={busy} onClick={load} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm disabled:opacity-50" style={{ borderColor: 'var(--border-subtle)', color: 'var(--ink)' }}><RefreshCw size={15} />重新加载</button>
      </div>

      {error ? <p role="alert" className="mb-4 text-sm" style={{ color: 'var(--warning-text)' }}>{error}</p> : null}
      {message ? <p role="status" className="mb-4 text-sm" style={{ color: 'var(--success-text)' }}>{message}</p> : null}

      {!config ? (
        <p style={{ color: 'var(--ink-muted)' }}>{busy ? '正在加载配置…' : '配置尚未加载，请重试'}</p>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            {field('llm-per-user-limit', 'LLM 精译：每用户窗口内上限（次）', '窗口内超过该次数则返回 429，防刷成本。', 'llmPerUserLimit')}
            {field('llm-window-hours', 'LLM 精译：限流窗口（小时）', '固定窗口，起点过期自动重置。', 'llmWindowHours')}
            {field('direct-per-ip-limit', '划词直译：每 IP 窗口内上限（次）', '仅对 DeepL/有道生效；超限回落免费词典。', 'directPerIpLimit')}
            {field('direct-window-hours', '划词直译：限流窗口（小时）', '固定窗口，起点过期自动重置。', 'directWindowHours')}
          </div>
          {!valid ? <p className="mt-3 text-sm" style={{ color: 'var(--warning-text)' }}>所有阈值须为不小于 1 的整数。</p> : null}
          <div className="mt-6 flex items-center gap-4">
            <button type="button" onClick={save} disabled={busy || !dirty || !valid} className="rounded-xl px-5 py-3 text-sm font-medium disabled:opacity-40" style={{ background: 'var(--ink)', color: 'var(--on-ink)' }}>{busy ? '处理中…' : '保存配置'}</button>
          </div>
        </>
      )}
    </section>
  )
}
