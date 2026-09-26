import { useEffect, useMemo, useRef, useState } from 'react'
import { BadgeCheck, ChevronDown, CircleAlert, LogIn, LogOut, Mail, MessageSquareText, ShieldCheck, UserPlus } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useSubscription } from '../hooks/useSubscription'
import {
  signInWithPassword,
  signOut,
  signUpWithPassword,
  getFeedbackQr,
  beginPaymentRequest,
  getMyPaymentRequest,
  getPaymentQr,
  submitPaymentRequest,
  PRICE_TEXT,
  PAID_DAYS,
} from '../services/supabase'
import { resolveAuthErrorMessage } from '../services/supabase/authError'
import { formatDateOnly, formatDateTime } from '../utils/dateFormat'
import PaymentModal from './PaymentModal'

export default function AuthPanel({ onOpenAdmin = null, showAdminEntry = true, triggerOpen = 0, collapsed = false }) {
  const {
    canAccessAdmin,
    isAuthenticated,
    status,
    user,
  } = useAuth()
  const { status: subStatus, isPro, importRemaining, bookmarkRemaining, refresh } = useSubscription()
  const [mode, setMode] = useState('sign_in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [membershipOpen, setMembershipOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentReq, setPaymentReq] = useState(null)
  const [paymentQr, setPaymentQr] = useState(null)
  const [paymentQrLoading, setPaymentQrLoading] = useState(false)
  const [paymentSubmitting, setPaymentSubmitting] = useState(false)
  const [paymentError, setPaymentError] = useState('')
  const [feedbackQr, setFeedbackQr] = useState(null)
  const [feedbackQrLoading, setFeedbackQrLoading] = useState(false)
  const [nudgeDismissedId, setNudgeDismissedId] = useState(() => {
    try { return localStorage.getItem('rr_payment_nudge_dismissed') } catch { return null }
  })
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

  // 悬浮按钮组收起时关闭账号面板与付费弹窗，避免悬空
  useEffect(() => {
    if (collapsed) {
      setPanelOpen(false)
      setPaymentOpen(false)
    }
  }, [collapsed])

  // 免费用户：拉取最近一笔付费申请，决定「待确认」还是「申请」入口
  useEffect(() => {
    if (!isAuthenticated || isPro) {
      setPaymentReq(null)
      setPaymentQr(null)
      return undefined
    }
    let active = true
    getMyPaymentRequest()
      .then((req) => { if (active) setPaymentReq(req) })
      .catch(() => { if (active) setPaymentReq(null) })
    return () => { active = false }
  }, [isAuthenticated, isPro])

  // 打开支付弹窗即发码建单（claimed_at=NULL，「发码未提交」）；冷却期返回 { cooldownUntil }
  useEffect(() => {
    if (!paymentOpen) return undefined
    let active = true
    setPaymentError('')
    // begin/submit 返回不含 createdAt，而 nudge 需展示发起时间，故再读一次补齐（失败则退回 begin 结果）
    beginPaymentRequest()
      .then(async (req) => {
        if (!active) return
        try {
          const full = await getMyPaymentRequest()
          if (active) setPaymentReq(full || req)
        } catch {
          if (active) setPaymentReq(req)
        }
      })
      .catch((err) => { if (active) setPaymentError(err?.message || '申请发起失败，请稍后重试') })
    return () => { active = false }
  }, [paymentOpen])

  // 面板重新打开时刷新订阅状态（覆盖「admin 已发放但 AuthPanel 常驻未重挂载」的陈旧场景）
  useEffect(() => {
    if (!panelOpen) return undefined
    refresh()
    return undefined
  }, [panelOpen, refresh])

  // pending（已提交）期间轮询支付单 + 订阅，admin 确认发放后自动翻转为 Pro
  useEffect(() => {
    if (!isAuthenticated || isPro) return undefined
    if (!(paymentReq?.status === 'pending' && paymentReq?.claimedAt != null)) return undefined
    const timer = setInterval(() => {
      getMyPaymentRequest().then((req) => { if (req) setPaymentReq(req) }).catch(() => {})
      refresh()
    }, 15000)
    return () => clearInterval(timer)
  }, [isAuthenticated, isPro, paymentReq?.status, paymentReq?.claimedAt, refresh])

  // 打开付费弹窗时才拉收款码（懒加载，避免面板常驻请求）
  useEffect(() => {
    if (!paymentOpen || paymentQr != null) return undefined
    let active = true
    setPaymentQrLoading(true)
    getPaymentQr()
      .then((qr) => { if (active) setPaymentQr(qr) })
      .catch(() => {})
      .finally(() => { if (active) setPaymentQrLoading(false) })
    return () => { active = false }
  }, [paymentOpen, paymentQr])

  // 打开意见反馈容器时才拉微信二维码（懒加载，避免面板常驻请求）
  useEffect(() => {
    if (!feedbackOpen || feedbackQr != null) return undefined
    let active = true
    setFeedbackQrLoading(true)
    getFeedbackQr()
      .then((qr) => { if (active) setFeedbackQr(qr) })
      .catch(() => {})
      .finally(() => { if (active) setFeedbackQrLoading(false) })
    return () => { active = false }
  }, [feedbackOpen, feedbackQr])

  useEffect(() => {
    // 付费弹窗打开时，面板自身的关闭监听让位给弹窗（弹窗自管遮罩/Esc）
    if (!panelOpen || paymentOpen) {
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
  }, [panelOpen, paymentOpen])

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
    setPaymentError('')

    try {
      const req = await submitPaymentRequest()
      setPaymentReq(req)
    } catch (submitError) {
      setPaymentError(submitError.message || '申请提交失败，请稍后重试')
    } finally {
      setPaymentSubmitting(false)
    }
  }

  function handleDismissNudge() {
    const orderId = paymentReq?.id ?? null
    setNudgeDismissedId(orderId)
    try {
      if (orderId) localStorage.setItem('rr_payment_nudge_dismissed', orderId)
      else localStorage.removeItem('rr_payment_nudge_dismissed')
    } catch {
      // 隐私模式等场景 localStorage 不可用，忽略持久化失败
    }
  }

  // 「暂不需要」只对当前这笔单临时静默；用户重新点「立即开通」= 重新表达支付意图，
  // 此时重置静默，让 nudge 的「发码未提交」兜底在关闭弹窗后恢复。
  function handleOpenPayment() {
    setNudgeDismissedId(null)
    try {
      localStorage.removeItem('rr_payment_nudge_dismissed')
    } catch {
      // 隐私模式等场景 localStorage 不可用，忽略
    }
    setPaymentOpen(true)
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

  // 「已提交」判别：status 恒为 pending 时用 claimedAt 区分「发码未提交」与「已提交」；
  // 同时约束 status='pending' 以免误判 rejected（已提交后被拒）为「已提交」。
  const paymentSubmitted = paymentReq?.status === 'pending' && paymentReq?.claimedAt != null
  // 「发码未提交」：已建单发码、尚未点「我已支付」——账户面板顶部挂常驻 nudge 兜底
  const paymentIssued = !isPro && paymentReq?.status === 'pending' && paymentReq?.claimedAt == null

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
        <div className="absolute bottom-full right-0 mb-3 w-[320px] max-w-[calc(100vw-2rem)] rounded-3xl p-4 backdrop-blur" style={{ border: '1px solid var(--popup-border)', background: 'var(--popup-bg)', boxShadow: 'var(--popup-shadow)' }}>
          {isAuthenticated ? (
            <div className="space-y-3">
              {paymentIssued && nudgeDismissedId !== paymentReq?.id ? (
                <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--gold)', background: 'var(--hover-bg)' }}>
                  <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    <BadgeCheck size={16} style={{ color: 'var(--gold-dark)' }} />
                    支付待确认
                  </div>
                  {paymentReq?.createdAt ? (
                    <div className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                      发起于 {formatDateTime(paymentReq.createdAt)}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={handleSubmitPayment}
                    disabled={paymentSubmitting}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition disabled:cursor-default"
                    style={{ background: 'var(--gold)', color: 'var(--on-gold)' }}
                  >
                    {paymentSubmitting ? '提交中...' : '确认已支付'}
                  </button>

                  <button
                    type="button"
                    onClick={handleDismissNudge}
                    className="mt-2 w-full text-center text-xs transition"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    暂不需要
                  </button>

                  {paymentError ? (
                    <div className="mt-2 text-xs" style={{ color: 'var(--danger-text)' }}>{paymentError}</div>
                  ) : null}
                </div>
              ) : null}
              <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--popup-border)', background: 'var(--popup-surface-hover)' }}>
                <div className="truncate text-sm font-medium" style={{ color: 'var(--ink)' }}>{user?.email || '当前账号'}</div>
                {subStatus ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                    <span className="font-medium" style={{ color: isPro ? 'var(--gold-dark)' : 'var(--ink-muted)' }}>{isPro ? 'Pro' : 'Free'}</span>
                    {!isPro && importRemaining != null && bookmarkRemaining != null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>导入余 {importRemaining} · 收藏余 {bookmarkRemaining}</span>
                      </>
                    )}
                    {isPro && subStatus.proExpiresAt && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>有效期至 {formatDateOnly(subStatus.proExpiresAt)}</span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>已登录</div>
                )}
              </div>

              <div className="rounded-2xl border" style={{ borderColor: 'var(--popup-border)', background: 'var(--popup-surface-hover)' }}>
                <button
                  type="button"
                  onClick={() => setMembershipOpen((currentValue) => !currentValue)}
                  aria-expanded={membershipOpen}
                  className="flex w-full items-center justify-between gap-2 p-4 text-left"
                >
                  <span className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    <BadgeCheck size={16} style={{ color: 'var(--gold-dark)' }} />
                    会员权益
                  </span>
                  <ChevronDown size={16} style={{ color: 'var(--ink-muted)', transform: membershipOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>

                {membershipOpen ? (
                  <div className="px-4 pb-4">
                    <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--surface-border)' }}>
                      <div className="grid grid-cols-[64px_1fr_1fr] text-xs" style={{ background: 'var(--hover-bg)' }}>
                        <div className="px-2 py-1.5" />
                        <div className="px-2 py-1.5 font-medium" style={{ color: isPro ? 'var(--ink-muted)' : 'var(--ink)' }}>Free{!isPro ? ' · 当前' : ''}</div>
                        <div className="px-2 py-1.5 font-medium" style={{ color: 'var(--gold-dark)' }}>Pro{isPro ? ' · 当前' : ''}</div>
                      </div>
                      <div className="grid grid-cols-[64px_1fr_1fr] text-xs" style={{ borderTop: '1px solid var(--popup-divider)' }}>
                        <div className="px-2 py-1.5" style={{ color: 'var(--ink-muted)' }}>导入</div>
                        <div className="px-2 py-1.5" style={{ color: 'var(--ink)' }}>累计 {subStatus?.importLimit ?? 30} 篇</div>
                        <div className="px-2 py-1.5 font-medium" style={{ color: 'var(--gold-dark)' }}>无限</div>
                      </div>
                      <div className="grid grid-cols-[64px_1fr_1fr] text-xs" style={{ borderTop: '1px solid var(--popup-divider)' }}>
                        <div className="px-2 py-1.5" style={{ color: 'var(--ink-muted)' }}>收藏</div>
                        <div className="px-2 py-1.5" style={{ color: 'var(--ink)' }}>每周 {subStatus?.bookmarkLimit ?? 30} 条</div>
                        <div className="px-2 py-1.5 font-medium" style={{ color: 'var(--gold-dark)' }}>无限</div>
                      </div>
                      <div className="grid grid-cols-[64px_1fr_1fr] text-xs" style={{ borderTop: '1px solid var(--popup-divider)' }}>
                        <div className="px-2 py-1.5" style={{ color: 'var(--ink-muted)' }}>价格</div>
                        <div className="px-2 py-1.5" style={{ color: 'var(--ink)' }}>免费</div>
                        <div className="px-2 py-1.5 font-medium" style={{ color: 'var(--gold-dark)' }}>{PRICE_TEXT} / {PAID_DAYS} 天</div>
                      </div>
                    </div>

                    {isPro ? null : paymentSubmitted ? (
                      <div className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--hover-bg)', color: 'var(--ink-muted)' }}>
                        已提交，等待管理员核对到账后开通
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleOpenPayment}
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition"
                        style={{ background: 'var(--gold)', color: 'var(--on-gold)' }}
                      >
                        立即开通
                      </button>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border" style={{ borderColor: 'var(--popup-border)', background: 'var(--popup-surface-hover)' }}>
                <button
                  type="button"
                  onClick={() => setFeedbackOpen((currentValue) => !currentValue)}
                  aria-expanded={feedbackOpen}
                  className="flex w-full items-center justify-between gap-2 p-4 text-left"
                >
                  <span className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    <MessageSquareText size={16} style={{ color: 'var(--ink-muted)' }} />
                    意见反馈
                  </span>
                  <ChevronDown size={16} style={{ color: 'var(--ink-muted)', transform: feedbackOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>

                {feedbackOpen ? (
                  <div className="px-4 pb-4">
                    <p className="text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>反馈问题或建议，被采纳可获得会员时长奖励。</p>
                    {feedbackQrLoading ? (
                      <div className="mt-3 flex h-40 items-center justify-center rounded-xl border border-dashed text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--ink-muted)' }}>
                        二维码加载中…
                      </div>
                    ) : feedbackQr ? (
                      <img src={feedbackQr} alt="反馈微信二维码" className="mx-auto mt-3 block rounded-xl" style={{ width: 160, height: 160, objectFit: 'contain', border: '1px solid var(--surface-border)' }} />
                    ) : (
                      <div className="mt-3 flex h-40 items-center justify-center rounded-xl border border-dashed text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--ink-muted)' }}>
                        二维码未设置，敬请期待
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

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

      <PaymentModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        qr={paymentQr}
        qrLoading={paymentQrLoading}
        pending={paymentSubmitted}
        submitting={paymentSubmitting}
        error={paymentError}
        onSubmit={handleSubmitPayment}
        verificationCode={paymentReq?.verificationCode ?? null}
        cooldownUntil={paymentReq?.cooldownUntil ?? null}
      />
    </div>
  )
}
