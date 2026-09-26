/**
 * 日期格式化工具。
 *
 * formatDateOnly — 将 ISO 时间戳格式化为「仅日期」字符串（YYYY-MM-DD），
 * 定死北京时间（Asia/Shanghai）。用于 Pro 到期日展示：pro_expires_at 为
 * timestamptz，若按用户本地时区转日期，跨日/跨时区会偏差一天，故固定东八区。
 */

export function formatDateOnly(iso) {
  if (!iso) {
    return ''
  }

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const pick = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

/**
 * formatDateTime — 将 ISO 时间戳格式化为「YYYY-MM-DD HH:mm」，同样定死北京时间
 * （Asia/Shanghai）。用于付费申请发起时间展示，避免跨时区偏差。
 */
export function formatDateTime(iso) {
  if (!iso) {
    return ''
  }

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const pick = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`
}
