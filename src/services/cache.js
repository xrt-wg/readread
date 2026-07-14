/**
 * 轻量请求去重层
 *
 * 同一 key 的并发请求共享一个 Promise，避免重复网络往返。
 * Promise 完成后自动清除，后续请求正常发起新调用。
 */

const pending = new Map()

/**
 * @param {string} key — 请求唯一标识（如 `bookmarks:${articleId}`）
 * @param {() => Promise<any>} fetcher — 实际请求函数
 * @returns {Promise<any>}
 */
export async function dedupe(key, fetcher) {
  if (pending.has(key)) return pending.get(key)
  const promise = fetcher().finally(() => {
    pending.delete(key)
  })
  pending.set(key, promise)
  return promise
}
