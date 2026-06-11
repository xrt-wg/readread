import { createContext, useEffect, useMemo, useState } from 'react'
import {
  ensureProfile,
  getSession,
  isCurrentUserAdmin,
  isSupabaseConfigured,
  subscribeToAuthStateChange,
} from '../services/supabase'
// claimLocalMigrationData 在迁移关闭后不再被调用，保留导入以备回滚
import { claimLocalMigrationData, getLocalMigrationMeta } from '../store/storage'

export const AuthContext = createContext(null)

/**
 * @deprecated 迁移功能已于 2026-06 关闭，pending_migration 状态不再产生。
 * 函数体保留以备后续回滚。当前编译产物中此函数不会被调用。
 */
function getLocalMigrationState(userId) {
  if (typeof window === 'undefined') {
    return {
      hasData: false,
      meta: getLocalMigrationMeta(),
      claimedByAnotherUser: false,
      completedByCurrentUser: false,
      canEnterPendingMigration: false,
    }
  }

  try {
    const articles = JSON.parse(window.localStorage.getItem('rr_articles') || '[]')
    const bookmarks = JSON.parse(window.localStorage.getItem('rr_bookmarks') || '[]')
    const readingMarks = JSON.parse(window.localStorage.getItem('rr_reading_marks') || '{}')
    const meta = getLocalMigrationMeta()

    const articleCount = Array.isArray(articles) ? articles.length : 0
    const bookmarkCount = Array.isArray(bookmarks) ? bookmarks.length : 0
    const readingMarkCount = readingMarks && typeof readingMarks === 'object'
      ? Object.keys(readingMarks).length
      : 0

    const hasData = articleCount > 0 || bookmarkCount > 0 || readingMarkCount > 0
    const claimedByAnotherUser = Boolean(meta.claimedByUserId && meta.claimedByUserId !== userId)
    const completedByCurrentUser = Boolean(userId && meta.completedByUserId === userId)

    return {
      hasData,
      meta,
      claimedByAnotherUser,
      completedByCurrentUser,
      canEnterPendingMigration: hasData && !claimedByAnotherUser && !completedByCurrentUser,
    }
  } catch {
    return {
      hasData: false,
      meta: getLocalMigrationMeta(),
      claimedByAnotherUser: false,
      completedByCurrentUser: false,
      canEnterPendingMigration: false,
    }
  }
}

function buildAuthenticatedState(session, profile, isAdmin) {
  const sessionValid = Boolean(session?.access_token && session?.user?.id)
  const userId = session?.user?.id ?? null

  // 迁移功能已关闭：不再产生 pending_migration 状态，直接进入 authenticated
  return {
    status: profile?.status === 'disabled' ? 'restricted' : 'authenticated',
    session,
    user: session?.user ?? null,
    userId,
    profile,
    isAdmin,
    sessionValid,
    hasCompletedInitialMigration: Boolean(profile?.has_completed_initial_migration),
    error: null,
    isConfigured: true,
  }
}

export function AuthProvider({ children }) {
  const [authState, setAuthState] = useState({
    status: 'initializing',
    session: null,
    user: null,
    userId: null,
    profile: null,
    isAdmin: false,
    sessionValid: false,
    hasCompletedInitialMigration: false,
    error: null,
    isConfigured: isSupabaseConfigured(),
  })
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setAuthState({
        status: 'misconfigured',
        session: null,
        user: null,
        userId: null,
        profile: null,
        isAdmin: false,
        sessionValid: false,
        hasCompletedInitialMigration: false,
        error: new Error('缺少 Supabase 配置'),
        isConfigured: false,
      })
      return undefined
    }

    let isActive = true

    async function resolveIdentityState(session) {
      if (!session) {
        return {
          status: 'anonymous',
          session: null,
          user: null,
          userId: null,
          profile: null,
          isAdmin: false,
          sessionValid: false,
          hasCompletedInitialMigration: false,
          error: null,
          isConfigured: true,
        }
      }

      const profile = await ensureProfile()
      const isAdmin = await isCurrentUserAdmin()

      return buildAuthenticatedState(session, profile, isAdmin)
    }

    async function initializeAuthState() {
      try {
        const session = await getSession()
        const nextState = await resolveIdentityState(session)

        if (!isActive) {
          return
        }

        setAuthState(nextState)
      } catch (error) {
        if (!isActive) {
          return
        }

        setAuthState({
          status: 'error',
          session: null,
          user: null,
          userId: null,
          profile: null,
          isAdmin: false,
          sessionValid: false,
          hasCompletedInitialMigration: false,
          error,
          isConfigured: true,
        })
      }
    }

    initializeAuthState()

    const unsubscribe = subscribeToAuthStateChange(async (session) => {
      try {
        const nextState = await resolveIdentityState(session)

        if (!isActive) {
          return
        }

        setAuthState(nextState)
      } catch (error) {
        if (!isActive) {
          return
        }

        setAuthState({
          status: 'error',
          session: null,
          user: null,
          userId: null,
          profile: null,
          isAdmin: false,
          sessionValid: false,
          hasCompletedInitialMigration: false,
          error,
          isConfigured: true,
        })
      }
    })

    return () => {
      isActive = false
      unsubscribe()
    }
  }, [refreshToken])

  const value = useMemo(() => {
    const isReady = authState.status !== 'initializing'

    return {
      ...authState,
      isReady,
      isAuthenticated: authState.status === 'authenticated',
      canUseCloudLibrary: authState.status === 'authenticated',
      canAccessAdmin: authState.isAdmin && authState.sessionValid,
      refreshAuthState: () => setRefreshToken((currentValue) => currentValue + 1),
    }
  }, [authState])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
