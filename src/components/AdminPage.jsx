import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { AlertTriangle, CreditCard, FileText, LayoutDashboard, ShieldAlert, ShieldCheck, SlidersHorizontal, TrendingUp, Users } from 'lucide-react'
import RecommendationModerationPanel from './RecommendationModerationPanel'
import FirstReadingAdminPanel from './FirstReadingAdminPanel'
import RecommendationConfigPanel from './RecommendationConfigPanel'
import GrowthStatsPanel from './GrowthStatsPanel'
import PaymentRequestsPanel from './PaymentRequestsPanel'
import StatCard from './AdminStatCard'
import { useAuth } from '../hooks/useAuth'
import { listAdminProfiles, listAuditLogs } from '../services/supabase'
import { listAdminSubscriptions } from '../services/subscription'
import { isLibraryAccessError } from '../services/errorUtils'
import { formatDateOnly } from '../utils/dateFormat'

function formatDateTime(value) {
  if (!value) {
    return '暂无'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '未知'
  }

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function resolveAdminErrorMessage(error, fallback) {
  if (isLibraryAccessError(error)) {
    return '后台权限已失效或当前会话已过期，系统正在刷新身份状态。'
  }

  return error?.message || fallback
}

function AccessDeniedState({ title, description, onExit }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: 'var(--parchment)' }}>
      <div className="max-w-lg w-full rounded-3xl border p-8 text-center" style={{ background: 'var(--card-bg-warm)', boxShadow: 'var(--popup-shadow)', borderColor: 'var(--popup-border)' }}>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
          <ShieldAlert size={24} />
        </div>
        <h1 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '28px', color: 'var(--ink)', marginBottom: '12px' }}>{title}</h1>
        <p className="text-sm leading-6" style={{ color: 'var(--ink-muted)' }}>{description}</p>
        {typeof onExit === 'function' ? (
          <button
            type="button"
            onClick={onExit}
            className="mt-5 rounded-2xl px-4 py-2 text-sm font-medium"
            style={{ background: 'var(--ink)', color: 'var(--on-ink)' }}
          >
            返回阅读前台
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default function AdminPage({ onExit }) {
  const { canAccessAdmin, isAuthenticated, isReady, profile, refreshAuthState, sessionValid } = useAuth()
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [adminProfiles, setAdminProfiles] = useState([])
  const [adminSubscriptions, setAdminSubscriptions] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [profilesError, setProfilesError] = useState('')
  const [auditLoading, setAuditLoading] = useState(true)
  const [auditError, setAuditError] = useState('')
  const [profileQuery, setProfileQuery] = useState('')
  const [auditCreatedFrom, setAuditCreatedFrom] = useState('')
  const [auditCreatedTo, setAuditCreatedTo] = useState('')
  const [auditSearchQuery, setAuditSearchQuery] = useState('')

  useEffect(() => {
    if (!canAccessAdmin) return undefined

    document.documentElement.classList.add('admin-layout-active')
    return () => document.documentElement.classList.remove('admin-layout-active')
  }, [canAccessAdmin])

  async function reloadAdminProfiles() {
    setProfilesLoading(true)
    setProfilesError('')

    const [profilesResult, subscriptionsResult] = await Promise.allSettled([
      listAdminProfiles(),
      listAdminSubscriptions(),
    ])

    if (profilesResult.status === 'fulfilled') {
      setAdminProfiles(profilesResult.value)
    } else {
      if (isLibraryAccessError(profilesResult.reason)) {
        refreshAuthState()
      }

      setProfilesError(resolveAdminErrorMessage(profilesResult.reason, '用户基础信息加载失败，请稍后重试'))
    }

    // 订阅信息加载失败：静默降级为「仅基础信息」，不阻断列表（RPC 未落库 / 权限异常）
    if (subscriptionsResult.status === 'fulfilled') {
      setAdminSubscriptions(subscriptionsResult.value)
    } else {
      setAdminSubscriptions([])
    }

    setProfilesLoading(false)
  }

  async function reloadAuditLogs(filters = {}) {
    setAuditLoading(true)
    setAuditError('')

    try {
      const nextCreatedFrom = filters.createdFrom !== undefined
        ? filters.createdFrom
        : auditCreatedFrom
          ? new Date(`${auditCreatedFrom}T00:00:00`).toISOString()
          : undefined
      const nextCreatedTo = filters.createdTo !== undefined
        ? filters.createdTo
        : auditCreatedTo
          ? new Date(`${auditCreatedTo}T23:59:59.999`).toISOString()
          : undefined

      const logs = await listAuditLogs({
        createdFrom: nextCreatedFrom,
        createdTo: nextCreatedTo,
        limit: 50,
      })
      setAuditLogs(logs)
    } catch (loadError) {
      if (isLibraryAccessError(loadError)) {
        refreshAuthState()
      }

      setAuditError(resolveAdminErrorMessage(loadError, '审计日志加载失败，请稍后重试'))
    } finally {
      setAuditLoading(false)
    }
  }

  useEffect(() => {
    if (!canAccessAdmin) {
      setAdminProfiles([])
      setAdminSubscriptions([])
      setAuditLogs([])
      setProfilesLoading(false)
      setAuditLoading(false)
      return
    }

    let isActive = true

    async function initializeAdminState() {
      setProfilesLoading(true)
      setProfilesError('')
      setAuditLoading(true)
      setAuditError('')

      const [profilesResult, auditLogsResult, subscriptionsResult] = await Promise.allSettled([
        listAdminProfiles(),
        listAuditLogs({ limit: 50 }),
        listAdminSubscriptions(),
      ])

      if (!isActive) {
        return
      }

      if (profilesResult.status === 'fulfilled') {
        setAdminProfiles(profilesResult.value)
      } else {
        if (isLibraryAccessError(profilesResult.reason)) {
          refreshAuthState()
        }

        setProfilesError(resolveAdminErrorMessage(profilesResult.reason, '用户基础信息加载失败，请稍后重试'))
      }

      if (auditLogsResult.status === 'fulfilled') {
        setAuditLogs(auditLogsResult.value)
      } else {
        if (isLibraryAccessError(auditLogsResult.reason)) {
          refreshAuthState()
        }

        setAuditError(resolveAdminErrorMessage(auditLogsResult.reason, '审计日志加载失败，请稍后重试'))
      }

      // 订阅信息加载失败：静默降级为「仅基础信息」，不阻断列表（RPC 未落库 / 权限异常）
      if (subscriptionsResult.status === 'fulfilled') {
        setAdminSubscriptions(subscriptionsResult.value)
      } else {
        setAdminSubscriptions([])
      }

      setProfilesLoading(false)
      setAuditLoading(false)
    }

    initializeAdminState()

    return () => {
      isActive = false
    }
  }, [canAccessAdmin])

  // 切换 Tab 时瞬时回到顶部，避免不同高度页面之间滚动位置错位造成跳变
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [currentPage])

  const profileSummary = useMemo(() => {
    return adminProfiles.reduce(
      (summary, currentProfile) => {
        summary.total += 1

        if (currentProfile.status === 'disabled') {
          summary.disabled += 1
        }

        if (currentProfile.lastSeenAt) {
          summary.activeSeen += 1
        }

        return summary
      },
      {
        total: 0,
        disabled: 0,
        activeSeen: 0,
      }
    )
  }, [adminProfiles])

  const visibleProfiles = useMemo(() => {
    const normalizedQuery = profileQuery.trim().toLowerCase()

    if (!normalizedQuery) {
      return adminProfiles
    }

    return adminProfiles.filter((currentProfile) => {
      return [
        currentProfile.displayName,
        currentProfile.userId,
        currentProfile.status,
      ].some((field) => String(field || '').toLowerCase().includes(normalizedQuery))
    })
  }, [adminProfiles, profileQuery])

  const subscriptionByUser = useMemo(() => {
    const map = new Map()
    for (const subscription of adminSubscriptions) {
      if (subscription.userId) {
        map.set(subscription.userId, subscription)
      }
    }
    return map
  }, [adminSubscriptions])

  const visibleAuditLogs = useMemo(() => {
    const normalizedQuery = auditSearchQuery.trim().toLowerCase()

    if (!normalizedQuery) {
      return auditLogs
    }

    return auditLogs.filter((log) => {
      return [
        log.action,
        log.targetType,
        log.targetId,
        log.actorUserId,
      ].some((field) => String(field || '').toLowerCase().includes(normalizedQuery))
    })
  }, [auditLogs, auditSearchQuery])

  const navItems = [
    { key: 'dashboard', label: '首页', icon: LayoutDashboard },
    { key: 'stats', label: '数据统计', icon: TrendingUp },
    { key: 'recommendations', label: '推荐审核', icon: FileText },
    { key: 'first-reading', label: '首次阅读', icon: FileText },
    { key: 'recommendation-config', label: '推荐提交设置', icon: SlidersHorizontal },
    { key: 'payments', label: '付费发放', icon: CreditCard },
    { key: 'audit', label: '审计日志', icon: AlertTriangle },
    { key: 'users', label: '用户基础信息', icon: Users },
  ]

  const currentPageMeta = navItems.find((item) => item.key === currentPage) || navItems[0]

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--parchment)' }}>
        <div className="text-sm" style={{ color: 'var(--ink-muted)' }}>正在准备后台身份...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <AccessDeniedState
        title="后台入口需要先登录"
        description="请先登录后再进入后台。"
        onExit={onExit}
      />
    )
  }

  if (!sessionValid || profile?.status === 'disabled') {
    return (
      <AccessDeniedState
        title="后台访问条件未满足"
        description="当前会话无效或账号受限，请重新登录后再试。"
        onExit={onExit}
      />
    )
  }

  if (!canAccessAdmin) {
    return (
      <AccessDeniedState
        title="你没有后台访问权限"
        description="当前账号没有管理员资格。"
        onExit={onExit}
      />
    )
  }

  return (
    <div className="min-h-screen w-full min-w-0 px-4 py-6 md:px-6 md:py-8" style={{ backgroundColor: 'var(--parchment)' }}>
      <div className="mx-auto lg:flex lg:max-w-[1280px] lg:gap-6">
        <aside className="mb-6 min-w-0 rounded-3xl border p-3 lg:sticky lg:top-6 lg:mb-0 lg:h-fit lg:w-[240px] lg:shrink-0 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--popup-border)' }}>
          <div className="mb-3 px-3 pt-2">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs" style={{ background: 'var(--success-bg)', color: 'var(--success-text)' }}>
              <ShieldCheck size={14} />
              管理员后台
            </div>
            <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '22px', color: 'var(--ink)', lineHeight: 1.2 }}>ReadRead</div>
          </div>

          <nav aria-label="后台导航" className="grid grid-cols-2 gap-2 px-1 py-2 sm:grid-cols-3 lg:flex lg:flex-col">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = currentPage === item.key

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setCurrentPage(item.key)}
                  aria-current={isActive ? 'page' : undefined}
                  className="min-w-0 rounded-2xl px-3 py-3 text-left transition lg:px-4"
                  style={{
                    background: isActive ? 'var(--ink)' : 'transparent',
                    color: isActive ? 'var(--on-ink)' : 'var(--ink)',
                  }}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Icon size={16} className="shrink-0" />
                    <span>{item.label}</span>
                  </div>
                </button>
              )
            })}
          </nav>

          <div className="mt-3 px-1">
            <button
              type="button"
              onClick={onExit}
              className="w-full rounded-2xl px-4 py-2 text-sm font-medium"
              style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}
            >
              返回阅读前台
            </button>
          </div>
        </aside>

        <div className="admin-content min-w-0 flex-1">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '34px', color: 'var(--ink)', lineHeight: 1.15 }}>{currentPageMeta.label}</h1>
            </div>
          </div>
          <div className={currentPage === 'dashboard' ? '' : 'hidden'}>
            <div className="mb-6 grid gap-4 md:grid-cols-3">
              <StatCard label="用户总量" value={profileSummary.total} />
              <StatCard label="受限用户" value={profileSummary.disabled} tone="warning" />
              <StatCard label="最近活跃用户" value={profileSummary.activeSeen} />
            </div>
          </div>
          <div className={currentPage === 'recommendations' ? '' : 'hidden'}>
            <RecommendationModerationPanel />
          </div>
          <div className={currentPage === 'stats' ? '' : 'hidden'}>
            <GrowthStatsPanel />
          </div>
          <div className={currentPage === 'first-reading' ? '' : 'hidden'}>
            <FirstReadingAdminPanel />
          </div>
          <div className={currentPage === 'recommendation-config' ? '' : 'hidden'}>
            <RecommendationConfigPanel />
          </div>
          <div className={currentPage === 'payments' ? '' : 'hidden'}>
            <PaymentRequestsPanel />
          </div>
          <div className={currentPage === 'users' ? '' : 'hidden'}>
            <div className="space-y-6">
              <section className="rounded-3xl border p-6" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--popup-border)' }}>
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-2" style={{ color: 'var(--ink-light)' }}>
                      <Users size={18} />
                      <span className="text-sm font-medium">用户基础信息查看</span>
                    </div>
                    <p className="mt-2 text-sm leading-6" style={{ color: 'var(--ink-muted)' }}>
                      仅展示基础资料、账号状态与最近活跃，不涉及阅读与收藏明细。
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 md:flex-row">
                    <input
                      value={profileQuery}
                      onChange={(event) => setProfileQuery(event.target.value)}
                      placeholder="搜索 display name / user id / status"
                      className="w-full rounded-2xl border px-3 py-2.5 text-sm outline-none md:w-80" style={{ borderColor: 'var(--surface-border)', background: 'var(--popup-bg)', color: 'var(--ink)' }}
                    />
                    <button
                      type="button"
                      onClick={reloadAdminProfiles}
                      className="rounded-2xl px-4 py-2 text-sm font-medium"
                      style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}
                    >
                      刷新
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <StatCard label="用户总量" value={profileSummary.total} />
                  <StatCard label="受限用户" value={profileSummary.disabled} tone="warning" />
                  <StatCard label="最近活跃用户" value={profileSummary.activeSeen} />
                </div>
              </section>

              <section className="rounded-3xl border p-6" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--popup-border)' }}>
                {profilesLoading ? (
                  <div className="text-sm" style={{ color: 'var(--ink-muted)' }}>正在加载用户基础信息...</div>
                ) : profilesError ? (
                  <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>
                    {profilesError}
                  </div>
                ) : visibleProfiles.length === 0 ? (
                  <div className="rounded-2xl border px-4 py-8 text-center text-sm" style={{ color: 'var(--ink-muted)', borderColor: 'var(--popup-border)', background: 'var(--surface-bg)' }}>
                    当前没有符合条件的用户基础资料。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleProfiles.map((currentProfile) => {
                      const statusMeta = currentProfile.status === 'disabled'
                        ? { label: '受限', background: 'var(--warning-bg)', color: 'var(--warning-text)' }
                        : { label: '正常', background: 'var(--success-bg)', color: 'var(--success-text)' }
                      const subscription = subscriptionByUser.get(currentProfile.userId)
                      const isProUser = subscription?.plan === 'pro'

                      return (
                        <div
                          key={currentProfile.userId}
                          className="rounded-2xl border px-4 py-4"
                          style={{ borderColor: 'var(--popup-border)', background: 'var(--popup-surface)' }}
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{currentProfile.displayName || '未设置 display name'}</div>
                              <div className="mt-1 text-xs break-all" style={{ color: 'var(--ink-muted)' }}>{currentProfile.userId}</div>
                            </div>
                            <span
                              className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
                              style={{ background: statusMeta.background, color: statusMeta.color }}
                            >
                              {statusMeta.label}
                            </span>
                          </div>
                          <div className="mt-4 space-y-2 border-t pt-3 text-sm" style={{ borderColor: 'var(--popup-border)' }}>
                            <div className="flex items-start gap-3">
                              <span className="w-16 shrink-0 text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>订阅</span>
                              {subscription ? (
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span
                                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                                    style={{ background: isProUser ? 'rgba(196,154,60,0.12)' : 'var(--hover-bg)', color: isProUser ? 'var(--gold-dark)' : 'var(--ink-muted)' }}
                                  >
                                    {isProUser ? 'Pro' : 'Free'}
                                  </span>
                                  <span style={{ color: 'var(--ink-muted)' }}>
                                    {isProUser
                                      ? (subscription.proExpiresAt ? `有效期至 ${formatDateOnly(subscription.proExpiresAt)}` : '')
                                      : (subscription.importRemaining != null && subscription.bookmarkRemaining != null
                                        ? `剩余导入 ${subscription.importRemaining} 篇 · 本周收藏 ${subscription.bookmarkRemaining} 条`
                                        : '—')}
                                  </span>
                                </span>
                              ) : (
                                <span style={{ color: 'var(--ink-muted)' }}>—</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="w-16 shrink-0 text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>最近活跃</span>
                              <span style={{ color: 'var(--ink-muted)' }}>{formatDateTime(currentProfile.lastSeenAt)}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="w-16 shrink-0 text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>创建时间</span>
                              <span style={{ color: 'var(--ink-muted)' }}>{formatDateTime(currentProfile.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>

          <div className={currentPage === 'audit' ? '' : 'hidden'}>
            <div className="space-y-6">
              <section className="rounded-3xl border p-6" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--popup-border)' }}>
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-2" style={{ color: 'var(--ink-light)' }}>
                      <AlertTriangle size={18} />
                      <span className="text-sm font-medium">审计日志查看</span>
                    </div>
                    <p className="mt-2 text-sm leading-6" style={{ color: 'var(--ink-muted)' }}>
                      记录推荐内容相关的后台操作轨迹。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => reloadAuditLogs()}
                    className="rounded-2xl px-4 py-2 text-sm font-medium"
                    style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}
                  >
                    刷新日志
                  </button>
                </div>
              </section>

              <section className="rounded-3xl border p-6" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--popup-border)' }}>
                <div className="mb-4 grid gap-3 md:grid-cols-3">
                  <input
                    type="date"
                    value={auditCreatedFrom}
                    onChange={(event) => setAuditCreatedFrom(event.target.value)}
                    className="rounded-2xl border px-3 py-2.5 text-sm outline-none" style={{ borderColor: 'var(--surface-border)', background: 'var(--popup-bg)', color: 'var(--ink)' }}
                  />
                  <input
                    type="date"
                    value={auditCreatedTo}
                    onChange={(event) => setAuditCreatedTo(event.target.value)}
                    className="rounded-2xl border px-3 py-2.5 text-sm outline-none" style={{ borderColor: 'var(--surface-border)', background: 'var(--popup-bg)', color: 'var(--ink)' }}
                  />
                  <input
                    value={auditSearchQuery}
                    onChange={(event) => setAuditSearchQuery(event.target.value)}
                    placeholder="搜索 action / target id / actor user id"
                    className="rounded-2xl border px-3 py-2.5 text-sm outline-none" style={{ borderColor: 'var(--surface-border)', background: 'var(--popup-bg)', color: 'var(--ink)' }}
                  />
                </div>

                <div className="mb-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => reloadAuditLogs({
                      createdFrom: auditCreatedFrom ? new Date(`${auditCreatedFrom}T00:00:00`).toISOString() : undefined,
                      createdTo: auditCreatedTo ? new Date(`${auditCreatedTo}T23:59:59.999`).toISOString() : undefined,
                    })}
                    className="rounded-2xl px-4 py-2 text-sm font-medium"
                    style={{ background: 'var(--ink)', color: 'var(--on-ink)' }}
                  >
                    应用筛选
                  </button>
                </div>

                {auditLoading ? (
                  <div className="text-sm" style={{ color: 'var(--ink-muted)' }}>正在加载审计日志...</div>
                ) : auditError ? (
                  <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>
                    {auditError}
                  </div>
                ) : visibleAuditLogs.length === 0 ? (
                  <div className="rounded-2xl border px-4 py-8 text-center text-sm" style={{ color: 'var(--ink-muted)', borderColor: 'var(--popup-border)', background: 'var(--surface-bg)' }}>
                    当前没有符合条件的审计日志。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleAuditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="rounded-2xl border px-4 py-4"
                        style={{ borderColor: 'var(--popup-border)', background: 'var(--popup-surface)' }}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{log.action}</div>
                            <div className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>对象：{log.targetType} · ID：{log.targetId || '—'}</div>
                          </div>
                          <span className="rounded-full px-2.5 py-1 text-xs" style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}>
                            {formatDateTime(log.createdAt)}
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2" style={{ color: 'var(--ink-muted)' }}>
                          <div>操作者：{log.actorUserId || '未知'}</div>
                          <div>角色：{log.actorRole || '未知'}</div>
                        </div>
                        {log.payload ? (
                          <pre className="mt-4 overflow-x-auto rounded-2xl px-4 py-3 text-xs" style={{ background: 'var(--ink)', color: 'var(--on-ink)' }}>{JSON.stringify(log.payload, null, 2)}</pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
