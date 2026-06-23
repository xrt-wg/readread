/**
 * 回顾机制 — 共享工具函数与调度计算
 *
 * 调度算法：简易 Leitner（基于 familiarity 1-5 + 固定间隔表 + 3 级反馈 Δ）
 * 统计计算：待复习数 / 已掌握数 / 总收藏数 —— 纯客户端，从 bookmark 数组一次遍历计算
 */

// ─── 常量 ────────────────────────────────────────────────────────────────────

export const TYPE_DOT = {
  word: '#fbbf24',
  phrase: '#34d399',
  sentence: '#818cf8',
  paragraph: '#818cf8',
}

export const TYPE_LABEL = { word: '词', phrase: '句', sentence: '句', paragraph: '段' }

/** familiarity → 间隔天数  */
const INTERVAL_DAYS = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 }

// ─── 工具函数 ────────────────────────────────────────────────────────────────

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function shuffleArray(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ─── 调度计算 ────────────────────────────────────────────────────────────────

/**
 * 根据用户反馈计算下次复习时间。
 *
 * 首次复习（familiarity=0）：直接映射反馈到熟悉度，不使用 delta 公式
 *   生疏 → 1、一般 → 2、熟练 → 3
 *   理由：delta 会使"一般"(+1) 和"生疏"(-1→钳制为1) 都得到 1，区分度不足
 *
 * 后续复习：familiarity += delta，钳制 [1,5]
 *
 * @param {import('../types/bookmark').Bookmark} bookmark
 * @param {'hard'|'ok'|'easy'} feedback
 * @returns {{ familiarity: number, nextReviewAt: string, reviewCount: number }}
 */
export function computeNextReview(bookmark, feedback) {
  const current = bookmark.familiarity || 0

  let familiarity
  if (current === 0) {
    familiarity = { hard: 1, ok: 2, easy: 3 }[feedback]
  } else {
    const delta = { hard: -1, ok: 1, easy: 2 }[feedback]
    familiarity = Math.min(5, Math.max(1, current + delta))
  }

  const days = INTERVAL_DAYS[familiarity]
  const nextReviewAt = new Date(Date.now() + days * 86400_000).toISOString()

  return {
    familiarity,
    nextReviewAt,
    reviewCount: (bookmark.reviewCount || 0) + 1,
  }
}

// ─── 队列判断 ────────────────────────────────────────────────────────────────

/**
 * 判断一张书签是否应在当前复习中呈现。
 *
 * 规则：
 *   1. reviewCount === 0 → 是（从未复习，随时可学）
 *   2. reviewCount > 0 && !nextReviewAt → 是（防御：已复习但无排期，视为异常，尽快重新排期）
 *   3. reviewCount > 0 && nextReviewAt ≤ now → 是（已到期）
 *   4. 其余 → 否（未到期）
 *
 * @param {import('../types/bookmark').Bookmark} bm
 * @param {number} [now] — 当前时间戳（ms）
 * @returns {boolean}
 */
export function isDue(bm, now = Date.now()) {
  if (!bm.reviewCount || bm.reviewCount === 0) return true
  if (!bm.nextReviewAt) return true
  return new Date(bm.nextReviewAt).getTime() <= now
}

// ─── 统计计算 ────────────────────────────────────────────────────────────────

/**
 * 从全部书签中计算三个回顾统计指标。
 *
 * @param {import('../types/bookmark').Bookmark[]} allBookmarks
 * @returns {{ due: number, mastered: string, total: number }}
 */
export function computeReviewStats(allBookmarks) {
  const now = Date.now()
  const total = allBookmarks.length

  // 待复习：使用共享的 isDue()
  const due = allBookmarks.filter((b) => isDue(b, now)).length

  // 已掌握：familiarity >= 4（仅统计有复习记录的卡片）
  const reviewed = allBookmarks.filter((b) => b.reviewCount > 0)
  const masteredCount = reviewed.filter(
    (b) => (b.familiarity || 0) >= 4
  ).length

  // 无复习记录时不显示百分比
  const mastered =
    reviewed.length > 0
      ? `${masteredCount}/${reviewed.length} · ${Math.round((masteredCount / reviewed.length) * 100)}%`
      : '尚无数据'

  return { due, mastered, total }
}
