/**
 * @mozilla/readability 的共享懒加载入口。
 * 统一为动态 import，避免静态 + 动态双导入导致 readability 落入主包（构建告警）。
 */
let _Readability = null

export async function getReadability() {
  if (!_Readability) {
    const mod = await import('@mozilla/readability')
    _Readability = mod.Readability
  }
  return _Readability
}
