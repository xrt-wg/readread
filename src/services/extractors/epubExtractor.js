/**
 * EPUB 提取器 — 通过 Netlify Function 调用 epub2MD。
 *
 * epub2MD 依赖 Node.js 内置模块（Buffer/path/fs/stream），
 * 无法在浏览器端直接运行。因此通过 /.netlify/functions/parse-epub 代理。
 */

/**
 * @param {import('../../types/extractor').ExtractorInput} input
 * @returns {Promise<import('../../types/extractor').ExtractionResult>}
 */
export async function extractFromEpub(input) {
  const buffer = input.buffer
  if (!buffer) throw new Error('缺少 EPUB 文件数据')

  // ArrayBuffer → base64
  const bytes = new Uint8Array(buffer)
  let base64 = ''
  for (let i = 0; i < bytes.length; i++) {
    base64 += String.fromCharCode(bytes[i])
  }
  base64 = btoa(base64)

  const res = await fetch('/.netlify/functions/parse-epub', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64 }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error || `EPUB 解析失败 (${res.status})`)
  }

  /** @type {import('../../types/extractor').ExtractionResult} */
  const result = await res.json()

  // 封面图缩放（服务端返回的是原始 base64）
  if (result.meta.coverUrl) {
    try {
      result.meta.coverUrl = await scaleCoverImage(result.meta.coverUrl)
    } catch {
      result.meta.coverUrl = null
    }
  }

  // 图片大小阈值处理
  for (const s of result.sections) {
    s.body.markdown = applyImageThreshold(s.body.markdown)
  }

  return result
}

// ═══════════════════════════════════════════════════════════════════════════════
// 封面图缩放
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 将 base64 封面图缩放至 max 300px。
 * @param {string} dataUrl
 * @returns {Promise<string>}
 */
function scaleCoverImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const maxSize = 300
      let { width, height } = img
      if (width <= maxSize && height <= maxSize) {
        resolve(dataUrl)
        return
      }
      const ratio = Math.min(maxSize / width, maxSize / height)
      width = Math.round(width * ratio)
      height = Math.round(height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('封面图加载失败'))
    img.src = dataUrl
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// 图片阈值
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 小图保留 base64，大图替换为占位符。
 * @param {string|null} md
 * @returns {string|null}
 */
function applyImageThreshold(md) {
  if (!md) return md
  return md.replace(/!\[([^\]]*)\]\((data:image\/[^)]+)\)/g, (match, alt, dataUri) => {
    const base64Data = dataUri.split(',')[1] || ''
    const estimatedSize = Math.round(base64Data.length * 0.75)
    if (estimatedSize < 50 * 1024) return match
    return `[Image: ${alt || '图片'}]`
  })
}
