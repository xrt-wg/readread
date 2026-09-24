import { useEffect, useMemo, useRef, useState } from 'react'
import { BadgeCheck, CircleAlert, LogIn, LogOut, Mail, ShieldCheck, UserPlus } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useSubscription } from '../hooks/useSubscription'
import {
  signInWithPassword,
  signOut,
  signUpWithPassword,
  getMyPaymentRequest,
  getPaymentQr,
  submitPaymentRequest,
  PAID_DAYS,
  PRICE_TEXT,
} from '../services/supabase'
import { resolveAuthErrorMessage } from '../services/supabase/authError'
import { formatDateOnly } from '../utils/dateFormat'

export default function AuthPanel({ onOpenAdmin = null, showAdminEntry = true, triggerOpen = 0, collapsed = false }) {
  const {
    canAccessAdmin,
    isAuthenticated,
    status,
    user,
  } = useAuth()
  const { status: subStatus, isPro, importRemaining, bookmarkRemaining } = useSubscription()
  const [mode, setMode] = useState('sign_in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [paymentReq, setPaymentReq] = useState(null)
  const [paymentQr, setPaymentQr] = useState(null)
  const [paymentSubmitting, setPaymentSubmitting] = useState(false)
  const panelRef = useRef(null)

  const title = useMemo(() => {
    return mode === 'sign_in' ? '账号登录' : '注册账号'
  }, [mode])

  // 外部触发打开面板（如 ReaderPage 门控提示）
  useEffect(() => {
    if (triggerOpen > 0) {
      setMode('sign_up')
      setPanelOpen(true)
    }
  }, [triggerOpen])

  // 悬浮按钮组收起时关闭账号面板，避免悬空
  useEffect(() => {
    if (collapsed) setPanelOpen(false)
  }, [collapsed])

  // 免费用户：拉取最近一笔付费申请与收款码，决定展示「待确认」还是「申请」入口
  useEffect(() => {
    if (!isAuthenticated || isPro) {
      setPaymentReq(null)
      setPaymentQr(null)
      return undefined
    }
    let active = true
    Promise.allSettled([getMyPaymentRequest(), getPaymentQr()])
      .then(([reqResult, qrResult]) => {
        if (!active) return
        setPaymentReq(reqResult.status === 'fulfilled' ? reqResult.value : null)
        setPaymentQr(qrResult.status === 'fulfilled' ? qrResult.value : null)
      })
    return () => { active = false }
  }, [isAuthenticated, isPro])

  useEffect(() => {
    if (!panelOpen) {
      return undefined
    }

    function handlePointerDown(event) {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        setPanelOpen(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setPanelOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [panelOpen])

  async function handleSubmit(event) {
    event.preventDefault()

    const normalizedEmail = email.trim()
    const normalizedPassword = password.trim()

    if (!normalizedEmail || !normalizedPassword) {
      setError('请输入邮箱和密码')
      setPanelOpen(true)
      return
    }

    setIsSubmitting(true)
    setError('')
    setErrorField(null)
    setMessage('')

    try {
      if (mode === 'sign_in') {
        await signInWithPassword({
          email: normalizedEmail,
          password: normalizedPassword,
        })
        setPanelOpen(false)
      } else {
        const result = await signUpWithPassword({
          email: normalizedEmail,
          password: normalizedPassword,
        })

        if (result.session) {
          setPanelOpen(false)
        } else {
          setMessage('注册成功，请检查邮箱完成确认后再登录')
          setPanelOpen(true)
        }
      }

      setPassword('')
    } catch (submitError) {
      console.error('[auth] 认证失败', submitError)
      const { message: friendlyMessage, field } = resolveAuthErrorMessage(submitError)
      setError(friendlyMessage)
      setErrorField(field)
      setPanelOpen(true)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSubmitPayment() {
    setPaymentSubmitting(true)
    setError('')
    setErrorField(null)
    setMessage('')

    try {
      const req = await submitPaymentRequest()
      setPaymentReq(req)
    } catch (submitError) {
      setError(submitError.message || '申请提交失败，请稍后重试')
      setPanelOpen(true)
    } finally {
      setPaymentSubmitting(false)
    }
  }

  async function handleSignOut() {
    setIsSubmitting(true)
    setError('')
    setErrorField(null)
    setMessage('')

    try {
      await signOut()
      setPanelOpen(false)
    } catch (submitError) {
      setError(submitError.message || '退出登录失败，请稍后重试')
      setPanelOpen(true)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (status !== 'anonymous' && status !== 'authenticated') {
    return null
  }

  return (
    <div ref={panelRef} className="fixed bottom-5 right-5 z-50" style={{ pointerEvents: collapsed ? 'none' : 'auto' }}>
      <button
        type="button"
        onClick={() => setPanelOpen((currentValue) => !currentValue)}
        aria-label={isAuthenticated ? '打开账号状态面板' : '打开登录面板'}
        className={`flex h-11 w-11 items-center justify-center rounded-full backdrop-blur transition ${panelOpen ? 'ring-2 ring-emerald-500/30' : ''}`}
        style={{
          border: '1px solid var(--popup-border)',
          background: 'var(--popup-bg)',
          boxShadow: 'var(--popup-shadow)',
          opacity: collapsed ? 0 : 1,
          transform: collapsed ? 'scale(0.3)' : 'scale(1)',
          pointerEvents: collapsed ? 'none' : 'auto',
        }}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: isAuthenticated ? 'var(--success-bg)' : 'var(--hover-bg)' }}>
          {isAuthenticated ? <ShieldCheck size={16} style={{ color: 'var(--success-text)' }} /> : mode === 'sign_in' ? <LogIn size={16} style={{ color: 'var(--ink)' }} /> : <UserPlus size={16} style={{ color: 'var(--ink)' }} />}
        </div>
      </button>

      {panelOpen ? (
        <div className="absolute bottom-full right-0 mb-3 w-[360px] max-w-[calc(100vw-2rem)] rounded-3xl p-4 backdrop-blur" style={{ border: '1px solid var(--popup-border)', background: 'var(--popup-bg)', boxShadow: 'var(--popup-shadow)' }}>
          {isAuthenticated ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-2xl border p-4" style={{ borderColor: 'var(--popup-border)', background: 'var(--popup-surface-hover)' }}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--success-bg)' }}>
                  <ShieldCheck size={16} style={{ color: 'var(--success-text)' }} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" style={{ color: 'var(--ink)' }}>{user?.email || '当前账号'}</div>
                  {subStatus ? (
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="rounded-full px-2 py-0.5 font-medium" style={{ background: isPro ? 'rgba(196,154,60,0.12)' : 'var(--hover-bg)', color: isPro ? 'var(--gold-dark)' : 'var(--ink-muted)' }}>
                        {isPro ? 'Pro' : 'Free'}
                      </span>
                      {!isPro && importRemaining != null && bookmarkRemaining != null && (
                        <span style={{ color: 'var(--ink-muted)' }}>剩余导入 {importRemaining} 篇 · 本周收藏 {bookmarkRemaining} 条</span>
                      )}
                      {isPro && subStatus.proExpiresAt && (
                        <span style={{ color: 'var(--ink-muted)' }}>有效期至 {formatDateOnly(subStatus.proExpiresAt)}</span>
                      )}
                    </div>
                  ) : (
                    <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>已登录</div>
                  )}
                </div>
              </div>

              {!isPro ? (
                <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--popup-border)', background: 'var(--popup-surface-hover)' }}>
                  <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    <BadgeCheck size={16} style={{ color: 'var(--gold-dark)' }} />
                    开通 Pro
                  </div>
                  <p className="mt-1 text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>
                    微信扫码支付 {PRICE_TEXT}，开通 {PAID_DAYS} 天 Pro。支付后点击下方按钮，管理员核对到账后开通。
                  </p>
                  {paymentQr ? (
                    <img src={paymentQr} alt="微信收款码" className="mx-auto mt-3 block rounded-xl" style={{ width: 160, height: 160, objectFit: 'contain', border: '1px solid var(--surface-border)' }} />
                  ) : (
                    <div className="mt-3 flex h-24 items-center justify-center rounded-xl border border-dashed text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--ink-muted)' }}>
                      收款码未设置，请稍后再试
                    </div>
                  )}
                  {paymentReq?.status === 'pending' ? (
                    <div className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--hover-bg)', color: 'var(--ink-muted)' }}>
                      已提交，等待管理员核对到账后开通
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSubmitPayment}
                      disabled={paymentSubmitting}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition disabled:cursor-default"
                      style={{ background: 'var(--gold)', color: 'var(--on-gold)' }}
                    >
                      {paymentSubmitting ? '提交中...' : '我已支付，申请开通'}
                    </button>
                  )}
                </div>
              ) : null}

              {message ? <div className="rounded-2xl px-4 py-3 text-xs" style={{ background: 'var(--success-bg)', color: 'var(--success-text)' }}>{message}</div> : null}
              {error ? <div className="rounded-2xl px-4 py-3 text-xs" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{error}</div> : null}

              <div className="space-y-2">
                {showAdminEntry && canAccessAdmin && typeof onOpenAdmin === 'function' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPanelOpen(false)
                      onOpenAdmin()
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-medium transition" style={{ border: '1px solid var(--popup-border)', background: 'var(--popup-surface)', color: 'var(--ink)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--popup-surface)' }}
                  >
                    <ShieldCheck size={14} />
                    进入后台
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-medium transition disabled:cursor-default" style={{ background: 'var(--ink)', color: 'var(--on-ink)' }}
                >
                  <LogOut size={14} />
                  {isSubmitting ? '退出中...' : '退出登录'}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
                  {mode === 'sign_in' ? <LogIn size={16} /> : <UserPlus size={16} />}
                  <span className="font-medium">{title}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMode((currentMode) => currentMode === 'sign_in' ? 'sign_up' : 'sign_in')
                    setError('')
                    setErrorField(null)
                    setMessage('')
                  }}
                  className="rounded-full px-3 py-1 text-xs transition" style={{ background: 'var(--hover-bg)', color: 'var(--ink-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-border)'; e.currentTarget.style.color = 'var(--ink)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; e.currentTarget.style.color = 'var(--ink-muted)' }}
                >
                  {mode === 'sign_in' ? '去注册' : '去登录'}
                </button>
              </div>
              <form className="space-y-3" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                    <Mail size={12} />
                    邮箱
                  </span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => { setEmail(event.target.value); if (error) { setError(''); setErrorField(null) } }}
                    aria-invalid={errorField === 'email'}
                    className="w-full rounded-2xl border px-3 py-3 text-sm outline-none transition focus:border-amber-600" style={{ borderColor: errorField === 'email' ? 'var(--danger-text)' : 'var(--popup-border)', background: 'var(--popup-surface)', color: 'var(--ink)' }}
                    placeholder="you@example.com"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs" style={{ color: 'var(--ink-muted)' }}>密码</span>
                  <input
                    type="password"
                    autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(event) => { setPassword(event.target.value); if (error) { setError(''); setErrorField(null) } }}
                    aria-invalid={errorField === 'password'}
                    className="w-full rounded-2xl border px-3 py-3 text-sm outline-none transition focus:border-amber-600" style={{ borderColor: errorField === 'password' ? 'var(--danger-text)' : 'var(--popup-border)', background: 'var(--popup-surface)', color: 'var(--ink)' }}
                    placeholder="至少 6 位"
                  />
                </label>
                {message ? <div className="rounded-2xl px-4 py-3 text-xs" style={{ background: 'var(--success-bg)', color: 'var(--success-text)' }}>{message}</div> : null}
                {error ? (
                  <div role="alert" className="flex items-start gap-2 rounded-2xl px-4 py-3 text-xs" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>
                    <CircleAlert size={14} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : null}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-medium transition disabled:cursor-default" style={{ background: 'var(--ink)', color: 'var(--on-ink)' }}
                >
                  {mode === 'sign_in' ? <LogIn size={14} /> : <UserPlus size={14} />}
                  {isSubmitting ? '提交中...' : mode === 'sign_in' ? '登录' : '注册'}
                </button>
              </form>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
