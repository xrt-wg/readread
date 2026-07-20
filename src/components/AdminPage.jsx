import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileText, LayoutDashboard, ShieldAlert, ShieldCheck, Users, X } from 'lucide-react'
import AuthPanel from './AuthPanel'
import { useAuth } from '../hooks/useAuth'
import { listAdminProfiles, listAuditLogs } from '../services/supabase'

function createEmptyForm() {
  return {
    id: null,
    title: '',
    source: '',
    description: '',
    text: '',
    markdown: '',
    coverImageUrl: '',
    sortOrder: 0,
    status: 'draft',
  }
}

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

function isAdminAccessError(error) {
  const message = String(error?.message || '').toLowerCase()
  const code = String(error?.code || '').toLowerCase()
  const status = error?.status

  return status === 401
    || status === 403
    || code === '401'
    || code === '403'
    || code === '42501'
    || message.includes('jwt')
    || message.includes('session')
    || message.includes('unauthorized')
    || message.includes('forbidden')
    || message.includes('permission denied')
    || message.includes('row-level security')
}

function resolveAdminErrorMessage(error, fallback) {
  if (isAdminAccessError(error)) {
    return '后台权限已失效或当前会话已过期，系统正在刷新身份状态。'
  }

  return error?.message || fallback
}

function StatCard({ label, value, tone = 'default' }) {
  const color = tone === 'warning' ? '#92400e' : tone === 'success' ? '#166534' : 'var(--ink)'
  const background = tone === 'warning' ? '#fef3c7' : tone === 'success' ? '#dcfce7' : 'rgba(255,255,255,0.78)'

  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        background,
        borderColor: 'rgba(28,25,23,0.08)',
      }}
    >
      <div style={{ fontSize: '12px', color: 'var(--ink-muted)', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '26px', fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function AccessDeniedState({ title, description, onExit }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: 'var(--parchment)' }}>
      <div className="max-w-lg w-full rounded-3xl border bg-white/90 p-8 text-center shadow-[0_12px_30px_rgba(28,25,23,0.08)]" style={{ borderColor: 'rgba(28,25,23,0.08)' }}>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(217,119,6,0.12)', color: '#b45309' }}>
          <ShieldAlert size={24} />
        </div>
        <h1 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '28px', color: 'var(--ink)', marginBottom: '12px' }}>{title}</h1>
        <p className="text-sm text-stone-600 leading-6">{description}</p>
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
  const { canAccessAdmin, isAuthenticated, isReady, profile, refreshAuthState, sessionValid, status, user } = useAuth()
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [featuredArticles, setFeaturedArticles] = useState([])
  const [adminProfiles, setAdminProfiles] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [profilesError, setProfilesError] = useState('')
  const [auditLoading, setAuditLoading] = useState(true)
  const [auditError, setAuditError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitMessage, setSubmitMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSeedingBuiltIns, setIsSeedingBuiltIns] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(createEmptyForm())
  const [featuredStatusFilter, setFeaturedStatusFilter] = useState('')
  const [profileQuery, setProfileQuery] = useState('')
  const [auditActionFilter, setAuditActionFilter] = useState('')
  const [auditTargetTypeFilter, setAuditTargetTypeFilter] = useState('')
  const [auditCreatedFrom, setAuditCreatedFrom] = useState('')
  const [auditCreatedTo, setAuditCreatedTo] = useState('')
  const [auditSearchQuery, setAuditSearchQuery] = useState('')
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState('')

  async function reloadFeaturedArticles() {
    setLoading(true)
    setError('')

    try {
      // 推荐内容管理已迁移至社区众包推荐系统（2026-06-16）
    } finally {
      setLoading(false)
    }
  }

  async function reloadAdminProfiles() {
    setProfilesLoading(true)
    setProfilesError('')

    try {
      const profiles = await listAdminProfiles()
      setAdminProfiles(profiles)
    } catch (loadError) {
      if (isAdminAccessError(loadError)) {
        refreshAuthState()
      }

      setProfilesError(resolveAdminErrorMessage(loadError, '用户基础信息加载失败，请稍后重试'))
    } finally {
      setProfilesLoading(false)
    }
  }

  async function reloadAuditLogs(filters = {}) {
    setAuditLoading(true)
    setAuditError('')

    try {
      const nextAction = filters.action !== undefined ? filters.action : auditActionFilter || undefined
      const nextTargetType = filters.targetType !== undefined ? filters.targetType : auditTargetTypeFilter || undefined
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
        action: nextAction,
        targetType: nextTargetType,
        createdFrom: nextCreatedFrom,
        createdTo: nextCreatedTo,
        limit: 50,
      })
      setAuditLogs(logs)
    } catch (loadError) {
      if (isAdminAccessError(loadError)) {
        refreshAuthState()
      }

      setAuditError(resolveAdminErrorMessage(loadError, '审计日志加载失败，请稍后重试'))
    } finally {
      setAuditLoading(false)
    }
  }

  useEffect(() => {
    if (!canAccessAdmin) {
      setFeaturedArticles([])
      setAdminProfiles([])
      setAuditLogs([])
      setLoading(false)
      setProfilesLoading(false)
      setAuditLoading(false)
      return
    }

    let isActive = true

    async function initializeAdminState() {
      setLoading(true)
      setError('')
      setProfilesLoading(true)
      setProfilesError('')
      setAuditLoading(true)
      setAuditError('')

      const [profilesResult, auditLogsResult] = await Promise.allSettled([
        listAdminProfiles(),
        listAuditLogs({ limit: 50 }),
      ])

      if (!isActive) {
        return
      }

      if (profilesResult.status === 'fulfilled') {
        setAdminProfiles(profilesResult.value)
      } else {
        if (isAdminAccessError(profilesResult.reason)) {
          refreshAuthState()
        }

        setProfilesError(resolveAdminErrorMessage(profilesResult.reason, '用户基础信息加载失败，请稍后重试'))
      }

      if (auditLogsResult.status === 'fulfilled') {
        setAuditLogs(auditLogsResult.value)
      } else {
        if (isAdminAccessError(auditLogsResult.reason)) {
          refreshAuthState()
        }

        setAuditError(resolveAdminErrorMessage(auditLogsResult.reason, '审计日志加载失败，请稍后重试'))
      }

      setLoading(false)
      setProfilesLoading(false)
      setAuditLoading(false)
    }

    initializeAdminState()

    return () => {
      isActive = false
    }
  }, [canAccessAdmin])

  const featuredSummary = useMemo(() => {
    return featuredArticles.reduce(
      (summary, article) => {
        if (article.status === 'published') {
          summary.published += 1
        } else if (article.status === 'draft') {
          summary.draft += 1
        } else if (article.status === 'archived') {
          summary.archived += 1
        }

        return summary
      },
      {
        published: 0,
        draft: 0,
        archived: 0,
      }
    )
  }, [featuredArticles])

  const visibleFeaturedArticles = useMemo(() => {
    if (!featuredStatusFilter) {
      return featuredArticles
    }

    return featuredArticles.filter((article) => article.status === featuredStatusFilter)
  }, [featuredArticles, featuredStatusFilter])

  const profileSummary = useMemo(() => {
    return adminProfiles.reduce(
      (summary, currentProfile) => {
        summary.total += 1

        if (currentProfile.status === 'disabled') {
          summary.disabled += 1
        }

        if (currentProfile.hasCompletedInitialMigration) {
          summary.completedMigration += 1
        }

        if (currentProfile.lastSeenAt) {
          summary.activeSeen += 1
        }

        return summary
      },
      {
        total: 0,
        disabled: 0,
        completedMigration: 0,
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
    {
      key: 'dashboard',
      label: '首页',
      description: '核心统计概览',
      icon: LayoutDashboard,
    },
    {
      key: 'audit',
      label: '审计日志',
      description: '查看后台动作轨迹',
      icon: AlertTriangle,
    },
    {
      key: 'users',
      label: '用户基础信息',
      description: '查看账号与迁移状态',
      icon: Users,
    },
  ]

  const currentPageMeta = navItems.find((item) => item.key === currentPage) || navItems[0]
  const featuredStatusLabelMap = {
    published: '已发布',
    draft: '草稿',
    archived: '已归档',
  }

  useEffect(() => {
    if (!isEditorOpen) {
      return undefined
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsEditorOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isEditorOpen])

  useEffect(() => {
    if (!submitMessage) {
      return undefined
    }

    setToastMessage(submitMessage)
    const timer = window.setTimeout(() => {
      setToastMessage('')
      setSubmitMessage('')
    }, 2400)

    return () => {
      window.clearTimeout(timer)
    }
  }, [submitMessage])

  useEffect(() => {
    if (currentPage !== 'articles' && isEditorOpen) {
      setIsEditorOpen(false)
    }
  }, [currentPage, isEditorOpen])

  function handleFormChange(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
  }

  function handleStartCreate() {
    setEditingId(null)
    setForm(createEmptyForm())
    setSubmitError('')
    setSubmitMessage('')
    setIsEditorOpen(true)
  }

  function handleStartEdit(article) {
    setEditingId(article.id)
    setForm({
      id: article.id,
      title: article.title ?? '',
      source: article.source ?? '',
      description: article.description ?? '',
      text: article.text ?? '',
      markdown: article.markdown ?? '',
      coverImageUrl: article.coverImageUrl ?? '',
      sortOrder: article.sortOrder ?? 0,
      status: article.status ?? 'draft',
    })
    setSubmitError('')
    setSubmitMessage('')
    setIsEditorOpen(true)
  }

  function handleCloseEditor() {
    setIsEditorOpen(false)
    setSubmitError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (!form.title.trim() || !form.text.trim()) {
      setSubmitError('标题和正文不能为空')
      return
    }

    setIsSubmitting(true)
    setSubmitError('')
    setSubmitMessage('')

    try {
      if (editingId) {
        const updatedArticle = await updateFeaturedArticle({
          ...form,
          id: editingId,
          text: form.text.trim(),
        })
        setSubmitMessage(updatedArticle.auditWarning ? `推荐内容已更新，但审计未完成：${updatedArticle.auditWarning}` : '推荐内容已更新')
      } else {
        const createdArticle = await createFeaturedArticle({
          ...form,
          text: form.text.trim(),
        })
        setSubmitMessage(createdArticle.auditWarning ? `推荐内容已创建，但审计未完成：${createdArticle.auditWarning}` : '推荐内容已创建')
      }

      await reloadFeaturedArticles()
      setEditingId(null)
      setForm(createEmptyForm())
      setIsEditorOpen(false)
    } catch (submitActionError) {
      if (isAdminAccessError(submitActionError)) {
        refreshAuthState()
      }

      setSubmitError(resolveAdminErrorMessage(submitActionError, '保存推荐内容失败，请稍后重试'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleStatusChange(articleId, nextStatus) {
    setIsSubmitting(true)
    setSubmitError('')
    setSubmitMessage('')

    try {
      const updatedArticle = await changeFeaturedArticleStatus(articleId, nextStatus)
      await reloadFeaturedArticles()
      setSubmitMessage(
        updatedArticle.auditWarning
          ? `内容状态已切换为 ${featuredStatusLabelMap[nextStatus] || nextStatus}，但审计未完成：${updatedArticle.auditWarning}`
          : `内容状态已切换为 ${featuredStatusLabelMap[nextStatus] || nextStatus}`
      )
    } catch (statusError) {
      if (isAdminAccessError(statusError)) {
        refreshAuthState()
      }

      setSubmitError(resolveAdminErrorMessage(statusError, '状态更新失败，请稍后重试'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSeedBuiltInArticles() {
    setIsSeedingBuiltIns(true)
    setSubmitError('')
    setSubmitMessage('')

    try {
      const result = await seedBuiltInFeaturedArticles()
      await reloadFeaturedArticles()

      if (result.createdCount === 0) {
        setSubmitMessage('内置推荐内容已全部存在，未执行重复导入。')
      } else {
        const baseMessage = `已导入 ${result.createdCount} 条内置推荐内容`
        const skippedMessage = result.skippedCount > 0 ? `，跳过 ${result.skippedCount} 条已存在内容` : ''
        const auditMessage = result.auditWarning ? `，但审计未完成：${result.auditWarning}` : ''
        setSubmitMessage(`${baseMessage}${skippedMessage}${auditMessage}`)
      }
    } catch (seedError) {
      if (isAdminAccessError(seedError)) {
        refreshAuthState()
      }

      setSubmitError(resolveAdminErrorMessage(seedError, '导入内置推荐内容失败，请稍后重试'))
    } finally {
      setIsSeedingBuiltIns(false)
    }
  }

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--parchment)' }}>
        <div className="text-sm text-stone-600">正在准备后台身份...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <AccessDeniedState
        title="后台入口需要先登录"
        description="当前处于匿名态，后台需要先完成登录并建立有效会话，之后系统才会进一步判断管理员资格。"
        onExit={onExit}
      />
    )
  }

  if (status === 'pending_migration') {
    return (
      <AccessDeniedState
        title="待迁移态暂不开放后台"
        description="当前账号仍处于首次迁移前阶段。根据既定口径，待迁移态不会进入正式云端主路径，也不会开放后台入口。请先完成迁移。"
        onExit={onExit}
      />
    )
  }

  if (!sessionValid || profile?.status === 'disabled') {
    return (
      <AccessDeniedState
        title="后台访问条件未满足"
        description="当前会话无效或账号处于受限状态，后台能力已被阻断。若你预期自己仍应拥有后台权限，请重新登录后再试。"
        onExit={onExit}
      />
    )
  }

  if (!canAccessAdmin) {
    return (
      <AccessDeniedState
        title="你没有后台访问权限"
        description="当前账号已登录，但没有有效的管理员资格，因此只能继续使用普通用户路径，不能进入后台。"
        onExit={onExit}
      />
    )
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-6 md:py-8" style={{ backgroundColor: 'var(--parchment)' }}>
      <AuthPanel showAdminEntry={false} />
      <div className="mx-auto lg:flex lg:max-w-[1280px] lg:gap-6">
        <aside className="mb-6 rounded-3xl border bg-white/85 p-3 lg:sticky lg:top-6 lg:mb-0 lg:h-fit lg:w-[240px] lg:self-start" style={{ borderColor: 'rgba(28,25,23,0.08)' }}>
          <div className="mb-3 px-3 pt-2">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs" style={{ background: 'rgba(21,128,61,0.1)', color: '#166534' }}>
              <ShieldCheck size={14} />
              管理员后台
            </div>
            <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '22px', color: 'var(--ink)', lineHeight: 1.2 }}>ReadRead</div>
            <div className="mt-2 text-xs text-stone-500 leading-5">首页看统计，子页面分别承载运营动作与查看能力。</div>
          </div>

          <div className="flex gap-2 overflow-x-auto px-1 py-2 lg:flex-col lg:overflow-visible">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = currentPage === item.key

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setCurrentPage(item.key)}
                  className="min-w-[132px] rounded-2xl px-4 py-3 text-left transition lg:min-w-0"
                  style={{
                    background: isActive ? 'var(--ink)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--ink)',
                  }}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </div>
                  <div className="mt-1 text-xs" style={{ color: isActive ? 'rgba(255,255,255,0.75)' : 'var(--ink-muted)' }}>
                    {item.description}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="mt-3 px-1">
            <button
              type="button"
              onClick={onExit}
              className="w-full rounded-2xl px-4 py-2 text-sm font-medium"
              style={{ background: 'rgba(28,25,23,0.08)', color: 'var(--ink)' }}
            >
              返回阅读前台
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '34px', color: 'var(--ink)', lineHeight: 1.15 }}>{currentPageMeta.label}</h1>
              <p className="mt-3 text-sm text-stone-600 leading-6 max-w-2xl">{currentPageMeta.description}</p>
            </div>
          </div>
          {currentPage === 'dashboard' ? (
            <>
              <div className="mb-6 grid gap-4 md:grid-cols-2">
                <StatCard label="管理员数量" value={adminProfiles.length} />
                <StatCard label="最近审计记录" value={auditLogs.length} />
              </div>

              <div className="mb-6 grid gap-4 md:grid-cols-4">
                <StatCard label="用户总量" value={profileSummary.total} />
                <StatCard label="已完成首次迁移" value={profileSummary.completedMigration} tone="success" />
                <StatCard label="受限用户" value={profileSummary.disabled} tone="warning" />
                <StatCard label="待迁移用户" value={Math.max(profileSummary.total - profileSummary.completedMigration, 0)} />
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <section className="rounded-3xl border bg-white/85 p-6" style={{ borderColor: 'rgba(28,25,23,0.08)' }}>
                  <div className="flex items-center gap-2 text-stone-700">
                    <LayoutDashboard size={18} />
                    <span className="text-sm font-medium">快捷入口</span>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-1">
                    <button
                      type="button"
                      onClick={() => setCurrentPage('articles')}
                      className="rounded-2xl border px-4 py-4 text-left transition hover:bg-stone-50"
                      style={{ borderColor: 'rgba(28,25,23,0.08)' }}
                    >
                      <div className="text-sm font-medium text-stone-800">查看推荐迁移说明</div>
                      <div className="mt-2 text-xs text-stone-500 leading-5">继续创建、编辑、发布推荐内容，处理当前草稿与归档内容。</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentPage('audit')}
                      className="rounded-2xl border px-4 py-4 text-left transition hover:bg-stone-50"
                      style={{ borderColor: 'rgba(28,25,23,0.08)' }}
                    >
                      <div className="text-sm font-medium text-stone-800">前往审计日志</div>
                      <div className="mt-2 text-xs text-stone-500 leading-5">查看最近后台动作轨迹，确认关键操作是否已形成闭环。</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentPage('users')}
                      className="rounded-2xl border px-4 py-4 text-left transition hover:bg-stone-50"
                      style={{ borderColor: 'rgba(28,25,23,0.08)' }}
                    >
                      <div className="text-sm font-medium text-stone-800">前往用户基础信息</div>
                      <div className="mt-2 text-xs text-stone-500 leading-5">查看账号状态、首次迁移进度与最近活跃情况。</div>
                    </button>
                  </div>
                </section>

                <section className="rounded-3xl border bg-white/85 p-6" style={{ borderColor: 'rgba(28,25,23,0.08)' }}>
                  <div className="flex items-center gap-2 text-stone-700">
                    <ShieldCheck size={18} />
                    <span className="text-sm font-medium">系统快照</span>
                  </div>
                  <div className="mt-4 space-y-4 text-sm text-stone-600">
                    <div className="rounded-2xl border px-4 py-4" style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.78)' }}>
                      <div className="text-xs text-stone-500">当前后台身份</div>
                      <div className="mt-2 text-sm font-medium text-stone-800">{user?.email || '未识别管理员账号'}</div>
                    </div>
                    <div className="rounded-2xl border px-4 py-4" style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.78)' }}>
                      <div className="text-xs text-stone-500">账号状态</div>
                      <div className="mt-2 text-sm font-medium text-stone-800">{profile?.status || 'unknown'}</div>
                    </div>
                    <div className="rounded-2xl border px-4 py-4" style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.78)' }}>
                      <div className="text-xs text-stone-500">会话有效性</div>
                      <div className="mt-2 text-sm font-medium text-stone-800">{sessionValid ? '有效' : '无效'}</div>
                    </div>
                    <div className="rounded-2xl border px-4 py-4" style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.78)' }}>
                      <div className="text-xs text-stone-500">最近活跃用户数</div>
                      <div className="mt-2 text-sm font-medium text-stone-800">{profileSummary.activeSeen}</div>
                    </div>
                  </div>
                </section>
              </div>
            </>
          ) : null}
          {currentPage === 'articles' ? (
            <div className="flex items-center justify-center py-24">
              <p style={{ fontSize: '14px', fontFamily: 'DM Sans', color: 'var(--ink-muted)' }}>
                推荐内容管理已迁移至社区众包推荐系统。用户可通过书架 Tab 提交推荐。
              </p>
            </div>
          ) : null}
          {/* 旧 articles 管理页已被替换 */}
          {false && (() => { return null })()}
          {currentPage === '_removed' ? (
            <div style={{ display: 'none' }}>
              <section className="rounded-3xl border bg-white/85 p-6" style={{ borderColor: 'rgba(28,25,23,0.08)' }}>
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-stone-700">
                      <FileText size={18} />
                      <span className="text-sm font-medium">内容列表</span>
                    </div>
                    <p className="mt-2 text-sm text-stone-600 leading-6">
                      管理推荐内容的创建、编辑与状态流转。列表区负责运营动作，右侧编辑器负责草稿录入与内容维护。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleStartCreate}
                      className="rounded-2xl px-4 py-2 text-xs font-medium"
                      style={{ background: 'var(--ink)', color: 'var(--on-ink)' }}
                    >
                      新建推荐内容
                    </button>
                    <button
                      type="button"
                      onClick={handleSeedBuiltInArticles}
                      disabled={isSeedingBuiltIns || isSubmitting}
                      className="rounded-2xl px-4 py-2 text-xs font-medium disabled:opacity-60"
                      style={{ background: 'rgba(28,25,23,0.08)', color: 'var(--ink)' }}
                    >
                      {isSeedingBuiltIns ? '导入中...' : '导入内置推荐内容'}
                    </button>
                  </div>
                </div>

                <div className="mb-5 rounded-2xl border px-4 py-4 text-xs text-stone-500 leading-6" style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.78)' }}>
                  当数据库为空时，可将当前前台使用的内置推荐内容一次性导入云端。该操作只会补齐缺失内容，不会覆盖已存在记录。
                </div>

                <div className="mb-5 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-stone-500">状态筛选</span>
                  {[
                    { value: '', label: '全部' },
                    { value: 'published', label: '已发布' },
                    { value: 'draft', label: '草稿' },
                    { value: 'archived', label: '已归档' },
                  ].map((option) => {
                    const isActive = featuredStatusFilter === option.value

                    return (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => setFeaturedStatusFilter(option.value)}
                        className="rounded-full px-3 py-1.5 text-xs font-medium transition"
                        style={{
                          background: isActive ? 'var(--ink)' : 'rgba(28,25,23,0.06)',
                          color: isActive ? '#fff' : 'var(--ink)',
                        }}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>

                {loading ? (
                  <div className="text-sm text-stone-500">正在加载推荐内容...</div>
                ) : error ? (
                  <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: '#fef2f2', color: '#b91c1c' }}>
                    {error}
                  </div>
                ) : featuredArticles.length === 0 ? (
                  <div className="rounded-2xl border px-4 py-8 text-center text-sm text-stone-500" style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.6)' }}>
                    当前还没有可见的推荐内容。
                  </div>
                ) : visibleFeaturedArticles.length === 0 ? (
                  <div className="rounded-2xl border px-4 py-8 text-center text-sm text-stone-500" style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.6)' }}>
                    当前筛选条件下暂无推荐内容。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleFeaturedArticles.map((article) => {
                      const statusMeta = article.status === 'published'
                        ? { label: '已发布', background: 'rgba(22,101,52,0.1)', color: '#166534' }
                        : article.status === 'draft'
                          ? { label: '草稿', background: 'rgba(120,113,108,0.12)', color: '#57534e' }
                          : { label: '已归档', background: 'rgba(217,119,6,0.12)', color: '#b45309' }

                      return (
                        <div
                          key={article.id}
                          className="rounded-2xl border px-4 py-4"
                          style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.9)' }}
                        >
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-stone-800">{article.title}</div>
                              <div className="mt-1 text-xs text-stone-500">{article.source || '未填写来源'} · sort {article.sortOrder ?? 0}</div>
                            </div>
                            <span
                              className="rounded-full px-2.5 py-1 text-xs font-medium"
                              style={{ background: statusMeta.background, color: statusMeta.color }}
                            >
                              {statusMeta.label}
                            </span>
                          </div>

                          <div className="text-sm text-stone-600 leading-6">{article.description || '暂无简介'}</div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleStartEdit(article)}
                              className="rounded-xl px-3 py-1.5 text-xs font-medium"
                              style={{ background: 'rgba(28,25,23,0.08)', color: 'var(--ink)' }}
                            >
                              编辑
                            </button>
                            {article.status !== 'published' ? (
                              <button
                                type="button"
                                onClick={() => handleStatusChange(article.id, 'published')}
                                disabled={isSubmitting}
                                className="rounded-xl px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                                style={{ background: 'rgba(22,101,52,0.1)', color: '#166534' }}
                              >
                                发布
                              </button>
                            ) : null}
                            {article.status !== 'draft' ? (
                              <button
                                type="button"
                                onClick={() => handleStatusChange(article.id, 'draft')}
                                disabled={isSubmitting}
                                className="rounded-xl px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                                style={{ background: 'rgba(120,113,108,0.12)', color: '#57534e' }}
                              >
                                转草稿
                              </button>
                            ) : null}
                            {article.status !== 'archived' ? (
                              <button
                                type="button"
                                onClick={() => handleStatusChange(article.id, 'archived')}
                                disabled={isSubmitting}
                                className="rounded-xl px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                                style={{ background: 'rgba(217,119,6,0.12)', color: '#b45309' }}
                              >
                                归档
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              <aside className="space-y-6">
                <section className="rounded-3xl border bg-white/85 p-6" style={{ borderColor: 'rgba(28,25,23,0.08)' }}>
                  <div className="mb-4 flex items-center gap-2 text-stone-700">
                    <Users size={18} />
                    <span className="text-sm font-medium">运营摘要</span>
                  </div>
                  <div className="space-y-3 text-sm text-stone-600">
                    <div className="rounded-2xl border px-4 py-4" style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.78)' }}>
                      <div className="text-xs text-stone-500">已发布推荐内容</div>
                      <div className="mt-2 text-lg font-semibold text-stone-800">{featuredSummary.published}</div>
                    </div>
                    <div className="rounded-2xl border px-4 py-4" style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.78)' }}>
                      <div className="text-xs text-stone-500">草稿内容</div>
                      <div className="mt-2 text-lg font-semibold text-stone-800">{featuredSummary.draft}</div>
                    </div>
                    <div className="rounded-2xl border px-4 py-4" style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.78)' }}>
                      <div className="text-xs text-stone-500">已归档内容</div>
                      <div className="mt-2 text-lg font-semibold text-stone-800">{featuredSummary.archived}</div>
                    </div>
                    <div className="rounded-2xl border px-4 py-4" style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.78)' }}>
                      <div className="text-xs text-stone-500">编辑面板状态</div>
                      <div className="mt-2 text-sm font-medium text-stone-800">{isEditorOpen ? '已打开' : '未打开'}</div>
                      <button
                        type="button"
                        onClick={handleStartCreate}
                        className="mt-3 rounded-xl px-3 py-1.5 text-xs font-medium"
                        style={{ background: 'var(--ink)', color: 'var(--on-ink)' }}
                      >
                        {editingId ? '继续编辑' : '打开新建面板'}
                      </button>
                    </div>
                  </div>
                </section>

                <section className="rounded-3xl border bg-white/85 p-6" style={{ borderColor: 'rgba(28,25,23,0.08)' }}>
                  <div className="mb-4 flex items-center gap-2 text-stone-700">
                    <AlertTriangle size={18} />
                    <span className="text-sm font-medium">后台身份上下文</span>
                  </div>
                  <div className="space-y-2 text-sm text-stone-600 leading-6">
                    <div>账号：{user?.email || '未识别'}</div>
                    <div>状态：{profile?.status || 'unknown'}</div>
                    <div>会话：{sessionValid ? '有效' : '无效'}</div>
                    <div>首次迁移：{profile?.has_completed_initial_migration ? '已完成' : '未完成'}</div>
                  </div>
                </section>
              </aside>
            </div>
          ) : null}

          {currentPage === 'users' ? (
            <div className="space-y-6">
              <section className="rounded-3xl border bg-white/85 p-6" style={{ borderColor: 'rgba(28,25,23,0.08)' }}>
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-stone-700">
                      <Users size={18} />
                      <span className="text-sm font-medium">用户基础信息查看</span>
                    </div>
                    <p className="mt-2 text-sm text-stone-600 leading-6">
                      当前只开放基础资料、账号状态、首次迁移和最近活跃时间查看，不展示用户文章正文、收藏详情或阅读资产明细。
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 md:flex-row">
                    <input
                      value={profileQuery}
                      onChange={(event) => setProfileQuery(event.target.value)}
                      placeholder="搜索 display name / user id / status"
                      className="w-full rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none md:w-80"
                    />
                    <button
                      type="button"
                      onClick={reloadAdminProfiles}
                      className="rounded-2xl px-4 py-2 text-sm font-medium"
                      style={{ background: 'rgba(28,25,23,0.08)', color: 'var(--ink)' }}
                    >
                      刷新
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-4">
                  <StatCard label="用户总量" value={profileSummary.total} />
                  <StatCard label="已完成首次迁移" value={profileSummary.completedMigration} tone="success" />
                  <StatCard label="受限用户" value={profileSummary.disabled} tone="warning" />
                  <StatCard label="最近活跃用户" value={profileSummary.activeSeen} />
                </div>
              </section>

              <section className="rounded-3xl border bg-white/85 p-6" style={{ borderColor: 'rgba(28,25,23,0.08)' }}>
                {profilesLoading ? (
                  <div className="text-sm text-stone-500">正在加载用户基础信息...</div>
                ) : profilesError ? (
                  <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: '#fef2f2', color: '#b91c1c' }}>
                    {profilesError}
                  </div>
                ) : visibleProfiles.length === 0 ? (
                  <div className="rounded-2xl border px-4 py-8 text-center text-sm text-stone-500" style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.6)' }}>
                    当前没有符合条件的用户基础资料。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleProfiles.map((currentProfile) => {
                      const statusMeta = currentProfile.status === 'disabled'
                        ? { label: '受限', background: 'rgba(217,119,6,0.12)', color: '#b45309' }
                        : { label: '正常', background: 'rgba(22,101,52,0.1)', color: '#166534' }

                      return (
                        <div
                          key={currentProfile.userId}
                          className="rounded-2xl border px-4 py-4"
                          style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.9)' }}
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <div className="text-sm font-medium text-stone-800">{currentProfile.displayName || '未设置 display name'}</div>
                              <div className="mt-1 text-xs text-stone-500 break-all">{currentProfile.userId}</div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span
                                className="rounded-full px-2.5 py-1 text-xs font-medium"
                                style={{ background: statusMeta.background, color: statusMeta.color }}
                              >
                                {statusMeta.label}
                              </span>
                              <span
                                className="rounded-full px-2.5 py-1 text-xs font-medium"
                                style={{
                                  background: currentProfile.hasCompletedInitialMigration ? 'rgba(22,101,52,0.1)' : 'rgba(120,113,108,0.12)',
                                  color: currentProfile.hasCompletedInitialMigration ? '#166534' : '#57534e',
                                }}
                              >
                                {currentProfile.hasCompletedInitialMigration ? '已完成首次迁移' : '未完成首次迁移'}
                              </span>
                            </div>
                          </div>
                          <div className="mt-4 grid gap-3 text-sm text-stone-600 md:grid-cols-3">
                            <div>最近活跃：{formatDateTime(currentProfile.lastSeenAt)}</div>
                            <div>首次迁移时间：{formatDateTime(currentProfile.initialMigratedAt)}</div>
                            <div>创建时间：{formatDateTime(currentProfile.createdAt)}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {currentPage === 'audit' ? (
            <div className="space-y-6">
              <section className="rounded-3xl border bg-white/85 p-6" style={{ borderColor: 'rgba(28,25,23,0.08)' }}>
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-stone-700">
                      <AlertTriangle size={18} />
                      <span className="text-sm font-medium">审计日志查看</span>
                    </div>
                    <p className="mt-2 text-sm text-stone-600 leading-6">
                      用于回答“谁在什么时候做了什么”。当前优先支持推荐内容相关后台动作的回溯查看。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => reloadAuditLogs()}
                    className="rounded-2xl px-4 py-2 text-sm font-medium"
                    style={{ background: 'rgba(28,25,23,0.08)', color: 'var(--ink)' }}
                  >
                    刷新日志
                  </button>
                </div>

                <div className="grid gap-4 md:grid-cols-4">
                  <StatCard label="日志总量" value={auditLogs.length} />
                  <StatCard label="可见结果" value={visibleAuditLogs.length} />
                  <StatCard label="筛选动作" value={auditActionFilter || '全部'} />
                  <StatCard label="筛选对象" value={auditTargetTypeFilter || '全部'} />
                </div>
              </section>

              <section className="rounded-3xl border bg-white/85 p-6" style={{ borderColor: 'rgba(28,25,23,0.08)' }}>
                <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_0.9fr_0.9fr_1.2fr]">
                  <select
                    value={auditActionFilter}
                    onChange={(event) => setAuditActionFilter(event.target.value)}
                    className="rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none"
                  >
                    <option value="">全部动作</option>
                    <option value="featured_article.create">featured_article.create</option>
                    <option value="featured_article.update">featured_article.update</option>
                    <option value="featured_article.published">featured_article.published</option>
                    <option value="featured_article.draft">featured_article.draft</option>
                    <option value="featured_article.archived">featured_article.archived</option>
                  </select>
                  <select
                    value={auditTargetTypeFilter}
                    onChange={(event) => setAuditTargetTypeFilter(event.target.value)}
                    className="rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none"
                  >
                    <option value="">全部对象</option>
                    <option value="featured_article">featured_article</option>
                    <option value="profile">profile</option>
                    <option value="admin_role">admin_role</option>
                  </select>
                  <input
                    type="date"
                    value={auditCreatedFrom}
                    onChange={(event) => setAuditCreatedFrom(event.target.value)}
                    className="rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none"
                  />
                  <input
                    type="date"
                    value={auditCreatedTo}
                    onChange={(event) => setAuditCreatedTo(event.target.value)}
                    className="rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none"
                  />
                  <input
                    value={auditSearchQuery}
                    onChange={(event) => setAuditSearchQuery(event.target.value)}
                    placeholder="搜索 action / target id / actor user id"
                    className="rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none"
                  />
                </div>

                <div className="mb-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => reloadAuditLogs({
                      action: auditActionFilter,
                      targetType: auditTargetTypeFilter,
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
                  <div className="text-sm text-stone-500">正在加载审计日志...</div>
                ) : auditError ? (
                  <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: '#fef2f2', color: '#b91c1c' }}>
                    {auditError}
                  </div>
                ) : visibleAuditLogs.length === 0 ? (
                  <div className="rounded-2xl border px-4 py-8 text-center text-sm text-stone-500" style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.6)' }}>
                    当前没有符合条件的审计日志。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleAuditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="rounded-2xl border px-4 py-4"
                        style={{ borderColor: 'rgba(28,25,23,0.08)', background: 'rgba(250,250,249,0.9)' }}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-sm font-medium text-stone-800">{log.action}</div>
                            <div className="mt-1 text-xs text-stone-500">对象：{log.targetType} · target: {log.targetId || '—'}</div>
                          </div>
                          <span className="rounded-full px-2.5 py-1 text-xs" style={{ background: 'rgba(28,25,23,0.08)', color: 'var(--ink)' }}>
                            {formatDateTime(log.createdAt)}
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3 text-sm text-stone-600 md:grid-cols-2">
                          <div>操作者：{log.actorUserId || '未知'}</div>
                          <div>角色：{log.actorRole || '未知'}</div>
                        </div>
                        {log.payload ? (
                          <pre className="mt-4 overflow-x-auto rounded-2xl bg-stone-950/95 px-4 py-3 text-xs text-stone-100">{JSON.stringify(log.payload, null, 2)}</pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : null}

          <div
            className={`fixed inset-0 z-40 transition ${isEditorOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
            style={{ background: 'rgba(28,25,23,0.28)', backdropFilter: 'blur(4px)' }}
            onClick={handleCloseEditor}
          />

          <aside
            className={`fixed right-0 top-0 z-50 flex h-screen w-full max-w-[460px] flex-col border-l bg-white shadow-[0_12px_40px_rgba(28,25,23,0.18)] transition-transform duration-300 ${isEditorOpen ? 'translate-x-0' : 'translate-x-full'}`}
            style={{ borderColor: 'rgba(28,25,23,0.08)' }}
          >
            <div className="flex items-center justify-between border-b px-6 py-5" style={{ borderColor: 'rgba(28,25,23,0.08)' }}>
              <div>
                <div className="text-lg font-semibold text-stone-800" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>{editingId ? '编辑推荐内容' : '新建推荐内容'}</div>
                <div className="mt-1 text-xs text-stone-500">在侧滑面板中维护推荐内容正文与基础信息。</div>
              </div>
              <button
                type="button"
                onClick={handleCloseEditor}
                className="rounded-full p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
              >
                <X size={16} />
              </button>
            </div>

            <form className="flex flex-1 flex-col" onSubmit={handleSubmit}>
              <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
                <input
                  value={form.title}
                  onChange={(event) => handleFormChange('title', event.target.value)}
                  placeholder="标题"
                  className="w-full rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                <input
                  value={form.source}
                  onChange={(event) => handleFormChange('source', event.target.value)}
                  placeholder="来源"
                  className="w-full rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                <input
                  value={form.description}
                  onChange={(event) => handleFormChange('description', event.target.value)}
                  placeholder="简介"
                  className="w-full rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(event) => handleFormChange('sortOrder', event.target.value)}
                  placeholder="排序值"
                  className="w-full rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                <textarea
                  value={form.text}
                  onChange={(event) => handleFormChange('text', event.target.value)}
                  placeholder="正文"
                  rows={8}
                  className="w-full rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none resize-y"
                />
                <textarea
                  value={form.markdown}
                  onChange={(event) => handleFormChange('markdown', event.target.value)}
                  placeholder="Markdown（可选）"
                  rows={5}
                  className="w-full rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none resize-y"
                />
                {submitError ? <div className="text-xs text-red-600">{submitError}</div> : null}
              </div>

              <div className="flex gap-3 border-t px-6 py-4" style={{ borderColor: 'rgba(28,25,23,0.08)' }}>
                <button
                  type="button"
                  onClick={handleCloseEditor}
                  className="flex-1 rounded-2xl border px-4 py-2.5 text-sm font-medium text-stone-700"
                  style={{ borderColor: 'rgba(28,25,23,0.12)' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-[1.4] rounded-2xl px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                  style={{ background: 'var(--ink)' }}
                >
                  {isSubmitting ? '提交中...' : editingId ? '保存编辑' : '创建推荐内容'}
                </button>
              </div>
            </form>
          </aside>

          <div
            className={`fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full px-4 py-2 text-xs font-medium text-white shadow-[0_10px_30px_rgba(28,25,23,0.18)] transition-all duration-300 ${toastMessage ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0 pointer-events-none'}`}
            style={{ background: 'var(--ink)' }}
          >
            {toastMessage}
          </div>
        </div>
      </div>
    </div>
  )
}
