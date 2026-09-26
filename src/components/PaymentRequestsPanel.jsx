import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, Check, ChevronDown, Copy, QrCode, RefreshCw, XCircle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  listPaymentRequests,
  confirmPaymentRequest,
  rejectPaymentRequest,
  reopenPaymentRequest,
  getPaymentQr,
  setPaymentQr,
  PAID_DAYS,
  formatPriceCents,
} from '../services/supabase'
import { isLibraryAccessError } from '../services/errorUtils'
import { copyText } from '../utils/clipboard'

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

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>{label}</div>
      <div className="mt-1 text-xs" style={{ color: 'var(--ink)' }}>{children}</div>
    </div>
  )
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  async function handleCopy() {
    const ok = await copyText(value)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="复制"
      title="复制"
      className="shrink-0 rounded-md p-1 transition"
      style={{ color: copied ? 'var(--success-text)' : 'var(--ink-muted)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

function RequestIdentity({ email, userId }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="truncate text-sm font-medium" style={{ color: 'var(--ink)' }}>{email || '（无邮箱）'}</span>
      <CopyButton value={email} />
      <span className="h-3.5 w-px shrink-0" aria-hidden="true" style={{ background: 'var(--surface-border)' }} />
      <span className="truncate text-xs" style={{ color: 'var(--ink-muted)' }}>{userId}</span>
      <CopyButton value={userId} />
    </div>
  )
}

export default function PaymentRequestsPanel() {
  const { refreshAuthState } = useAuth()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [qrUrl, setQrUrl] = useState(null)
  const [qrOpen, setQrOpen] = useState(false)
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

  async function handleReopen(request) {
    if (busyId) return
    const target = request.email || request.userId
    if (!window.confirm(`复位 ${target} 的冷却期？复位后该用户可重新申请。`)) return
    setBusyId(request.id)
    setError('')
    try {
      await reopenPaymentRequest(request.id)
      await reload()
    } catch (failure) {
      setError(failure.message || '复位操作失败，请稍后重试')
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
      <div className="mb-6 rounded-2xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--popup-bg)' }}>
        <button
          type="button"
          onClick={() => setQrOpen((currentValue) => !currentValue)}
          aria-expanded={qrOpen}
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--ink)' }}>
            <QrCode size={16} style={{ color: 'var(--ink-muted)' }} />
            收款码
          </span>
          <span className="flex items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={qrUrl ? { background: 'var(--success-bg)', color: 'var(--success-text)' } : { background: 'var(--warning-bg)', color: 'var(--warning-text)' }}
            >
              {qrUrl ? '已设置' : '未设置'}
            </span>
            <ChevronDown size={16} style={{ color: 'var(--ink-muted)', transform: qrOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </span>
        </button>

        {qrOpen ? (
          <div className="px-4 pb-4">
            <p className="text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>账号面板展示给用户的微信收款码；上传后免费用户即可扫码支付，可随时替换或清除。</p>
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
        ) : null}
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>付费发放</h2>
          <p className="mt-2 text-sm leading-6" style={{ color: 'var(--ink-muted)' }}>
            用户扫码支付 {formatPriceCents()} 后提交「我已支付」申请；核对到账后点「确认发放」即开通对应天数 Pro。核对码用于定位「付了款但未提交」的用户。
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
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>待处理</span>
                <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>{pending.length}</span>
              </div>
              {pending.map((r) => (
                <div key={r.id} className="rounded-2xl border p-4" style={{ borderColor: 'var(--popup-border)', background: 'var(--popup-surface)' }}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <RequestIdentity email={r.email} userId={r.userId} />
                    <div className="flex shrink-0 items-center gap-2">
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
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 md:grid-cols-4" style={{ borderColor: 'var(--popup-border)' }}>
                    <Field label="金额">{formatPriceCents(r.amountCents)}</Field>
                    <Field label="天数">{r.requestedDays ?? PAID_DAYS} 天</Field>
                    <Field label="提交时间">{formatDateTime(r.createdAt)}</Field>
                    <div className="min-w-0">
                      <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>核对码</div>
                      {r.verificationCode ? (
                        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                          <span style={{ color: 'var(--ink)' }}>{r.verificationCode}</span>
                          <span style={{ color: r.claimedAt ? 'var(--success-text)' : 'var(--warning-text)' }}>
                            {r.claimedAt ? '已提交' : '发码未提交'}
                          </span>
                        </div>
                      ) : (
                        <div className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>—</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {done.length > 0 && (
            <div className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>已处理</span>
                <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: 'var(--hover-bg)', color: 'var(--ink-muted)' }}>{done.length}</span>
              </div>
              {done.map((r) => {
                const meta = STATUS_META[r.status] || STATUS_META.rejected
                const inCooldown = r.status === 'rejected' && r.cooldownUntil != null && new Date(r.cooldownUntil).getTime() > Date.now()
                return (
                  <div key={r.id} className="rounded-2xl border p-4" style={{ borderColor: 'var(--popup-border)', background: 'var(--popup-surface)' }}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <RequestIdentity email={r.email} userId={r.userId} />
                      <div className="flex shrink-0 items-center gap-2">
                        {inCooldown ? (
                          <button
                            type="button"
                            onClick={() => handleReopen(r)}
                            disabled={busyId === r.id}
                            className="rounded-xl px-3 py-2 text-sm font-medium transition disabled:cursor-default"
                            style={{ border: '1px solid var(--border-subtle)', color: 'var(--ink-muted)' }}
                          >
                            复位冷却
                          </button>
                        ) : null}
                        <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: meta.background, color: meta.color }}>{meta.label}</span>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 md:grid-cols-4" style={{ borderColor: 'var(--popup-border)' }}>
                      <Field label="金额">{formatPriceCents(r.amountCents)}</Field>
                      <Field label="天数">{r.requestedDays ?? PAID_DAYS} 天</Field>
                      <Field label="提交时间">{formatDateTime(r.createdAt)}</Field>
                      {r.status === 'granted' ? (
                        <Field label="发放时间">{formatDateTime(r.grantedAt)}</Field>
                      ) : (
                        <div className="min-w-0">
                          <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>拒绝原因</div>
                          <div className="mt-1 text-xs" style={{ color: 'var(--ink)' }}>{r.rejectedReason || '—'}</div>
                          {inCooldown ? (
                            <div className="mt-1 text-xs" style={{ color: 'var(--warning-text)' }}>冷却至 {formatDateTime(r.cooldownUntil)}</div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
