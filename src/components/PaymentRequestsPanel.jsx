import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, RefreshCw, XCircle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  listPaymentRequests,
  confirmPaymentRequest,
  rejectPaymentRequest,
  getPaymentQr,
  setPaymentQr,
  PRICE_TEXT,
} from '../services/supabase'
import { isLibraryAccessError } from '../services/errorUtils'

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_META = {
  pending: { label: '待发放', background: 'var(--warning-bg)', color: 'var(--warning-text)' },
  granted: { label: '已发放', background: 'var(--success-bg)', color: 'var(--success-text)' },
  rejected: { label: '已拒绝', background: 'var(--danger-bg)', color: 'var(--danger-text)' },
}

export default function PaymentRequestsPanel() {
  const { refreshAuthState } = useAuth()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [qrUrl, setQrUrl] = useState(null)
  const [qrSaving, setQrSaving] = useState(false)
  const [qrError, setQrError] = useState('')
  const fileInputRef = useRef(null)
  const alive = useRef(false)

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const rows = await listPaymentRequests()
      if (alive.current) setRequests(rows)
    } catch (failure) {
      if (alive.current) {
        setError(failure.message || '申请列表加载失败，请稍后重试')
        if (isLibraryAccessError(failure)) refreshAuthState()
      }
    } finally {
      if (alive.current) setLoading(false)
    }
  }

  useEffect(() => {
    alive.current = true
    reload()
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    let active = true
    getPaymentQr().then((url) => { if (active) setQrUrl(url) }).catch(() => {})
    return () => { active = false }
  }, [])

  async function handleConfirm(request) {
    if (busyId) return
    const target = request.email || request.userId
    if (!window.confirm(`确认发放 ${request.requestedDays} 天 Pro 给 ${target}？`)) return
    setBusyId(request.id)
    setError('')
    try {
      await confirmPaymentRequest(request.id)
      await reload()
    } catch (failure) {
      setError(failure.message || '发放失败，请稍后重试')
      if (isLibraryAccessError(failure)) refreshAuthState()
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(request) {
    if (busyId) return
    const target = request.email || request.userId
    if (!window.confirm(`拒绝 ${target} 的申请？`)) return
    setBusyId(request.id)
    setError('')
    try {
      await rejectPaymentRequest(request.id)
      await reload()
    } catch (failure) {
      setError(failure.message || '拒绝操作失败，请稍后重试')
      if (isLibraryAccessError(failure)) refreshAuthState()
    } finally {
      setBusyId(null)
    }
  }

  async function handleQrFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setQrError('图片过大，请使用 2MB 以内的收款码图片')
      return
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('读取图片失败'))
      reader.readAsDataURL(file)
    })
    setQrSaving(true)
    setQrError('')
    try {
      await setPaymentQr(dataUrl)
      setQrUrl(dataUrl)
    } catch (failure) {
      setQrError(failure.message || '上传失败，请稍后重试')
      if (isLibraryAccessError(failure)) refreshAuthState()
    } finally {
      setQrSaving(false)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleClearQr() {
    if (!window.confirm('清除当前收款码？')) return
    setQrSaving(true)
    setQrError('')
    try {
      await setPaymentQr(null)
      setQrUrl(null)
    } catch (failure) {
      setQrError(failure.message || '清除失败，请稍后重试')
      if (isLibraryAccessError(failure)) refreshAuthState()
    } finally {
      setQrSaving(false)
    }
  }

  const pending = requests.filter((r) => r.status === 'pending')
  const done = requests.filter((r) => r.status !== 'pending')

  return (
    <section className="rounded-3xl border p-5 sm:p-7" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--border-subtle)' }}>
      <div className="mb-6 rounded-2xl border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--popup-bg)' }}>
        <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>收款码</div>
        <p className="mt-1 text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>账号面板展示给用户的微信收款码；上传后免费用户即可扫码支付，可随时替换或清除。</p>
        <div className="mt-3 flex items-center gap-4">
          {qrUrl ? (
            <img src={qrUrl} alt="收款码" className="rounded-lg" style={{ width: 96, height: 96, objectFit: 'contain', border: '1px solid var(--surface-border)' }} />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--ink-muted)' }}>未设置</div>
          )}
          <div className="flex flex-col gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleQrFile} className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={qrSaving}
              className="rounded-xl px-3 py-2 text-sm font-medium transition disabled:cursor-default"
              style={{ background: 'var(--gold)', color: 'var(--on-gold)' }}
            >
              {qrSaving ? '处理中...' : '上传收款码'}
            </button>
            {qrUrl ? (
              <button
                type="button"
                onClick={handleClearQr}
                disabled={qrSaving}
                className="rounded-xl px-3 py-2 text-sm font-medium"
                style={{ border: '1px solid var(--border-subtle)', color: 'var(--ink-muted)' }}
              >
                清除
              </button>
            ) : null}
          </div>
        </div>
        {qrError ? <div className="mt-2 text-xs" style={{ color: 'var(--danger-text)' }}>{qrError}</div> : null}
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>付费发放</h2>
          <p className="mt-2 text-sm leading-6" style={{ color: 'var(--ink-muted)' }}>
            用户扫码支付 {PRICE_TEXT} 后提交「我已支付」申请；核对到账后点「确认发放」即开通对应天数 Pro。
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium"
          style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}
        >
          <RefreshCw size={14} />
          刷新
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{error}</div>
      ) : null}

      {loading ? (
        <div className="py-10 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>正在加载申请…</div>
      ) : pending.length === 0 && done.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>暂无付费申请</div>
      ) : (
        <div className="space-y-4">
          {pending.length > 0 && (
            <div className="space-y-3">
              {pending.map((r) => (
                <div key={r.id} className="rounded-2xl border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--popup-bg)' }}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium" style={{ color: 'var(--ink)' }}>{r.email || '（无邮箱）'}</div>
                      <div className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                        {PRICE_TEXT} / {r.requestedDays} 天 · 提交于 {formatDateTime(r.createdAt)}
                      </div>
                      <div className="mt-0.5 break-all text-xs" style={{ color: 'var(--ink-muted)' }}>{r.userId}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleReject(r)}
                        disabled={busyId === r.id}
                        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition disabled:cursor-default"
                        style={{ border: '1px solid var(--border-subtle)', color: 'var(--ink-muted)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--danger-bg)'; e.currentTarget.style.color = 'var(--danger-text)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}
                      >
                        <XCircle size={14} />
                        拒绝
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirm(r)}
                        disabled={busyId === r.id}
                        className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition disabled:cursor-default"
                        style={{ background: 'var(--gold)', color: 'var(--on-gold)' }}
                      >
                        <BadgeCheck size={14} />
                        {busyId === r.id ? '处理中...' : '确认发放'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {done.length > 0 && (
            <div className="border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="mb-2 text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>已处理</div>
              <div className="space-y-2">
                {done.map((r) => {
                  const meta = STATUS_META[r.status] || STATUS_META.rejected
                  return (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-2.5" style={{ background: 'var(--hover-bg)' }}>
                      <div className="min-w-0">
                        <span className="text-sm" style={{ color: 'var(--ink)' }}>{r.email || '（无邮箱）'}</span>
                        <span className="ml-2 text-xs" style={{ color: 'var(--ink-muted)' }}>{formatDateTime(r.createdAt)}</span>
                      </div>
                      <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: meta.background, color: meta.color }}>{meta.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
