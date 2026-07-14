import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ensureProfile,
  getSession,
  isCurrentUserAdmin,
  isSupabaseConfigured,
  subscribeToAuthStateChange,
} from '../services/supabase'

export const AuthStateContext = createContext(null)
export const AuthActionsContext = createContext(null)

/** @deprecated 使用 AuthStateContext + AuthActionsContext */
export const AuthContext = AuthStateContext

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

  const refreshAuthState = useCallback(() => {
    setRefreshToken(v => v + 1)
  }, [])

  const stateValue = useMemo(() => {
    const isReady = authState.status !== 'initializing'
    return {
      ...authState,
      isReady,
      isAuthenticated: authState.status === 'authenticated',
      canUseCloudLibrary: authState.status === 'authenticated',
      canAccessAdmin: authState.isAdmin && authState.sessionValid,
    }
  }, [authState.status, authState.userId, authState.isAdmin,
      authState.sessionValid, authState.error, authState.profile,
      authState.isConfigured, authState.hasCompletedInitialMigration,
      authState.session, authState.user])

  const actionsValue = useMemo(() => ({ refreshAuthState }), [refreshAuthState])

  return (
    <AuthStateContext.Provider value={stateValue}>
      <AuthActionsContext.Provider value={actionsValue}>
        {children}
      </AuthActionsContext.Provider>
    </AuthStateContext.Provider>
  )
}
