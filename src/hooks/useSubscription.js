import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { getSubscriptionStatus } from '../services/subscription'

/**
 * 订阅状态 hook：读取并缓存 Free/Pro 身份与额度余量。
 *
 * - 未登录 / 非云端库：status 为 null，余量均为 null
 * - Pro 用户：importRemaining / bookmarkRemaining 为 null（语义 = 不限量）
 * - Free 用户：余量为非负整数
 */
export function useSubscription() {
  const { canUseCloudLibrary, userId } = useAuth()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!canUseCloudLibrary || !userId) {
      setStatus(null)
      return
    }
    setLoading(true)
    try {
      const next = await getSubscriptionStatus()
      setStatus(next)
    } catch {
      // RPC 未就绪（迁移未落库）或网络异常：静默降级，不打扰主流程
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [canUseCloudLibrary, userId])

  useEffect(() => { refresh() }, [refresh])

  const isPro = status?.plan === 'pro'
  const importRemaining = status && !isPro && status.importLimit != null
    ? Math.max(0, status.importLimit - status.importUsed)
    : null
  const bookmarkRemaining = status && !isPro && status.bookmarkLimit != null
    ? Math.max(0, status.bookmarkLimit - status.bookmarkUsed)
    : null

  return { status, loading, refresh, isPro, importRemaining, bookmarkRemaining }
}
