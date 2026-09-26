/**
 * 剪贴板工具。
 *
 * copyText — 复制文本到系统剪贴板。优先 navigator.clipboard（需安全上下文，
 * localhost/https），否则回退 execCommand('copy')（兼容 http 部署）。
 * 返回 Promise<boolean>：true 表示复制成功。
 */

export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 回退到 execCommand 兜底
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(textarea)
  return ok
}
