/**
 * 认证错误 → 用户友好的中文提示
 *
 * 按 error.message（不区分大小写）关键字与 error.status 分类，
 * 返回 { message, field }：field 指向出错输入框（email | password | null）。
 *
 * AuthPanel.jsx 登录/注册失败时调用，替代「直接展示原始英文 message」。
 */
export function resolveAuthErrorMessage(error) {
  const message = String(error?.message || '').toLowerCase()
  const status = error?.status

  // 顺序敏感：先匹配更具体的场景
  if (message.includes('email not confirmed') || message.includes('not confirmed')) {
    return { message: '邮箱尚未验证，请先查收确认邮件后再登录', field: 'email' }
  }

  if (message.includes('rate limit') || message.includes('too many requests') || status === 429) {
    return { message: '操作过于频繁，请稍后再试', field: null }
  }

  if (message.includes('already registered') || message.includes('already exists') || message.includes('user already')) {
    return { message: '该邮箱已注册，可直接登录', field: 'email' }
  }

  if (message.includes('password should be') || message.includes('at least 6')) {
    return { message: '密码需至少 6 位', field: 'password' }
  }

  if (message.includes('unable to validate email') || message.includes('invalid format') || message.includes('invalid email')) {
    return { message: '邮箱格式不正确', field: 'email' }
  }

  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) {
    return { message: '邮箱或密码不正确', field: null }
  }

  if (message.includes('failed to fetch') || message.includes('request failed') || message.includes('network') || message.includes('timeout')) {
    return { message: '网络异常，请检查连接后重试', field: null }
  }

  return { message: '认证失败，请稍后重试', field: null }
}
