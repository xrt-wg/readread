import { useEffect, useMemo, useRef, useState } from 'react'
import { LogIn, LogOut, Mail, ShieldCheck, UserPlus } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  signInWithPassword,
  signOut,
  signUpWithPassword,
} from '../services/supabase'

export default function AuthPanel({ onOpenAdmin = null, showAdminEntry = true }) {
  const {
    canAccessAdmin,
    hasCompletedInitialMigration,
    hasBlockedLocalMigrationData,
    isAuthenticated,
    sessionValid,
    status,
    user,
    userId,
  } = useAuth()
  const [mode, setMode] = useState('sign_in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const panelRef = useRef(null)

  const title = useMemo(() => {
    return mode === 'sign_in' ? '账号登录' : '注册账号'
  }, [mode])

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
      setError(submitError.message || '认证请求失败，请稍后重试')
      setPanelOpen(true)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSignOut() {
    setIsSubmitting(true)
    setError('')
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

  if (status !== 'anonymous' && status !== 'authenticated' && status !== 'pending_migration') {
    return null
  }

  return (
    <div ref={panelRef} className="fixed bottom-5 right-5 z-50">
      <button
        type="button"
        onClick={() => setPanelOpen((currentValue) => !currentValue)}
        aria-label={isAuthenticated ? '打开账号状态面板' : '打开登录面板'}
        className={`flex h-11 w-11 items-center justify-center rounded-full border border-stone-900/10 bg-white/92 shadow-[0_12px_30px_rgba(28,25,23,0.12)] backdrop-blur transition hover:bg-white ${panelOpen ? 'ring-2 ring-emerald-500/30' : ''}`}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: isAuthenticated ? 'rgba(16,185,129,0.12)' : 'rgba(28,25,23,0.08)' }}>
          {isAuthenticated ? <ShieldCheck size={16} className="text-emerald-600" /> : mode === 'sign_in' ? <LogIn size={16} className="text-stone-700" /> : <UserPlus size={16} className="text-stone-700" />}
        </div>
      </button>

      {panelOpen ? (
        <div className="absolute bottom-full right-0 mb-3 w-[360px] max-w-[calc(100vw-2rem)] rounded-3xl border border-stone-900/10 bg-white/96 p-4 shadow-[0_20px_60px_rgba(28,25,23,0.18)] backdrop-blur">
          {isAuthenticated ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-stone-900/10 bg-stone-50/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-stone-700">
                      <ShieldCheck size={16} className="text-emerald-600" />
                      <span className="font-medium">已登录</span>
                    </div>
                    <div className="mt-2 break-all text-sm text-stone-800">{user?.email || '当前账号'}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${sessionValid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {sessionValid ? '会话有效' : '会话异常'}
                    </span>
                    <span className="rounded-full bg-stone-100 px-2 py-1 text-[11px] font-medium text-stone-700">
                      {canAccessAdmin ? 'admin' : '普通用户'}
                    </span>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-xs text-stone-600">
                  <div className="rounded-xl bg-white px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-stone-400">user id</div>
                    <div className="mt-1 break-all text-stone-700">{userId || '未识别'}</div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-white px-3 py-2">迁移状态：{hasCompletedInitialMigration ? '已完成首次迁移' : status === 'pending_migration' ? '待迁移' : '未完成首次迁移'}</div>
                    <div className="rounded-xl bg-white px-3 py-2">后台权限：{canAccessAdmin ? '可进入后台' : '未授予管理员资格'}</div>
                  </div>
                </div>
              </div>

              {status === 'pending_migration' ? (
                <div className="rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800">已识别为待迁移态，后续会进入正式迁移流程。</div>
              ) : null}
              {hasBlockedLocalMigrationData ? (
                <div className="rounded-2xl bg-stone-100 px-4 py-3 text-xs text-stone-600">
                  当前设备仍保留一份已被其他账号认领的本地历史数据，系统已自动隔离，当前账号不会读取或迁移这份数据。
                </div>
              ) : null}
              {message ? <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{message}</div> : null}
              {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-600">{error}</div> : null}

              <div className="grid gap-3 sm:grid-cols-2">
                {showAdminEntry && canAccessAdmin && typeof onOpenAdmin === 'function' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPanelOpen(false)
                      onOpenAdmin()
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-stone-900/10 bg-white px-3 py-3 text-sm font-medium text-stone-800 transition hover:bg-stone-50"
                  >
                    <ShieldCheck size={14} />
                    进入后台
                  </button>
                ) : (
                  <div className="hidden sm:block" />
                )}
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-900 px-3 py-3 text-sm font-medium text-white transition disabled:cursor-default disabled:bg-stone-400"
                >
                  <LogOut size={14} />
                  {isSubmitting ? '退出中...' : '退出登录'}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-stone-700">
                  {mode === 'sign_in' ? <LogIn size={16} /> : <UserPlus size={16} />}
                  <span className="font-medium">{title}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMode((currentMode) => currentMode === 'sign_in' ? 'sign_up' : 'sign_in')
                    setError('')
                    setMessage('')
                  }}
                  className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600 transition hover:bg-stone-200 hover:text-stone-800"
                >
                  {mode === 'sign_in' ? '去注册' : '去登录'}
                </button>
              </div>
              <form className="space-y-3" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs text-stone-500">
                    <Mail size={12} />
                    邮箱
                  </span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-3 text-sm text-stone-900 outline-none transition focus:border-amber-600"
                    placeholder="you@example.com"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-stone-500">密码</span>
                  <input
                    type="password"
                    autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-2xl border border-stone-900/10 bg-stone-50 px-3 py-3 text-sm text-stone-900 outline-none transition focus:border-amber-600"
                    placeholder="至少 6 位"
                  />
                </label>
                {message ? <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{message}</div> : null}
                {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-600">{error}</div> : null}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-900 px-3 py-3 text-sm font-medium text-white transition disabled:cursor-default disabled:bg-stone-400"
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
