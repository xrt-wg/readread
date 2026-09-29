/**
 * 开发期性能/调试日志：生产构建（import.meta.env.PROD）下为 no-op。
 * 用于替代散落的 console.info('[AI_PERF_*]' / '[DIRECT_PERF_*]' / '[BOOKMARK_FALLBACK]')。
 */
export function devLog(...args) {
  if (import.meta.env.DEV) console.info(...args)
}
