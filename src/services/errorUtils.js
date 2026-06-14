/**
 * 库操作错误处理公共模块
 *
 * isLibraryAccessError — 识别 RLS 拒绝 / JWT 过期 / 权限错误
 * resolveLibraryErrorMessage — 给出用户友好的中文提示
 *
 * library.js 和 importItems.js 均从此模块导入。
 */

export function isLibraryAccessError(error) {
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

export function resolveLibraryErrorMessage(error, fallback) {
  if (isLibraryAccessError(error)) {
    return '当前云端会话已失效或访问权限已变化，系统正在刷新身份状态。'
  }

  return error?.message || fallback
}
