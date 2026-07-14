import { useContext } from 'react'
import { AuthStateContext, AuthActionsContext } from '../providers/AuthProvider'

export function useAuth() {
  const state = useContext(AuthStateContext)
  const actions = useContext(AuthActionsContext)

  if (!state) {
    throw new Error('useAuth 必须在 AuthProvider 内使用')
  }

  return { ...state, ...actions }
}
