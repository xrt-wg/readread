/**
 * Netlify Function — EPUB 解析服务
 *
 * 接收 EPUB 文件（base64），在 Node.js 环境中运行 epub2MD 解析，
 * 返回 ExtractionResult JSON。解决 epub2MD 依赖 Node.js 内置模块
 * （Buffer/path/fs/stream）在浏览器端不可用的问题。
 *
 * 注意：.cjs 扩展名强制 CommonJS 模式，因为 epub2MD 的 ESM 构建
 * 存在 lodash 导入路径问题。
 */
const { parseEpub } = require('epub2md')

/**
 * 深度优先遍历 TOC 树，生成平铺的 ExtractionSection 数组。
 */
// counter 共享累加器跨递归调用，避免跨子树 order 值碰撞
function flattenTocTree(tocItems, depth = 0, counter = { value: 0 }) {
  const result = []
  for (const item of tocItems) {
    result.push({
      heading:    item.name || null,
      depth,
      order:      counter.value++,
      _sectionId: item.sectionId,
      body:       { text: '', markdown: null },
    })
    if (item.children && item.children.length > 0) {
      result.push(...flattenTocTree(item.children, depth + 1, counter))
    }
  }
  return result
}

function fallbackSpineFlat(sections) {
  return sections.map((s, i) => ({
    heading:    null,
    depth:      0,
    order:      i,
    _sectionId: s.id,
    body:       { text: '', markdown: null },
  }))
}

function stripMarkdown(md) {
  return md
    .replace(/\s?<\?xml[^>]*\?>\s?/gi, '')
    .replace(/\s?<!DOCTYPE[^>]*>\s?/gi, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
    .replace(/[#*>`~_]/g, '')
    .replace(/\n{2,}/g, '\n\n')
    .trim()
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    }
  }

  const { base64 } = body
  if (!base64) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing base64 EPUB data' }),
    }
  }

  try {
    const fileBuffer = Buffer.from(base64, 'base64')
    const epub = parseEpub(fileBuffer, { type: 'buffer' })
    const { structure, sections } = epub
    const toc = structure?.toc
    const metadata = structure?.opf?.metadata || {}

    // TOC → 平铺 sections
    const extractionSections = toc
      ? flattenTocTree(toc.tree)
      : fallbackSpineFlat(sections)

    // 填充 body
    const sectionMap = new Map(sections.map(s => [s.id, s]))
    for (const es of extractionSections) {
      const epubSection = es._sectionId ? sectionMap.get(es._sectionId) : null
      if (epubSection) {
        try {
          const rawMd = epubSection.toMarkdown?.() || epubSection.htmlString || ''
          const md = rawMd
            .replace(/\s?<\?xml[^>]*\?>\s?/gi, '')
            .replace(/\s?<!DOCTYPE[^>]*>\s?/gi, '')
          es.body.markdown = md
          es.body.text = stripMarkdown(md)
        } catch {
          es.body.text = ''
        }
      }
      delete es._sectionId
    }

    // 封面图 → base64（原始数据，客户端缩放）
    let coverUrl = null
    try {
      const manifest = structure?.opf?.manifest
      if (manifest) {
        const items = Array.from(manifest)
        const coverItem = items.find(i =>
          i.id && /cover/i.test(i.id) && /\.(jpg|jpeg|png|gif|webp)/i.test(i.href || '')
        ) || items.find(i =>
          /cover/i.test(i.filename || '') && /\.(jpg|jpeg|png|gif|webp)/i.test(i.filename || '')
        )
        if (coverItem) {
          const file = epub.getFile?.(coverItem.href)
          const raw = file?.asNodeBuffer?.() || file
          if (raw && raw.length > 0 && raw.length < 500 * 1024) {
            const ext = (coverItem.href || '').split('.').pop()?.toLowerCase() || 'jpeg'
            const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
            coverUrl = `data:${mime};base64,${Buffer.from(raw).toString('base64')}`
          }
        }
      }
    } catch { /* 封面提取失败不影响正文 */ }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meta: {
          title:  String(metadata.title || '未命名 EPUB'),
          author: Array.isArray(metadata.author)
            ? metadata.author.join(', ')
            : (metadata.author || null),
          format: 'epub',
          coverUrl,
          lang:   String(metadata.language || 'en'),
        },
        sections: extractionSections,
      }),
    }
  } catch (e) {
    const msg = String(e.message || '')
    const friendly = /drm|encrypt|protected|rights/i.test(msg)
      ? '该 EPUB 受 DRM 保护或已加密，无法导入。请使用无 DRM 的 EPUB 文件。'
      : /invalid|corrupt|zip/i.test(msg)
        ? '该 EPUB 文件已损坏或格式无效，无法解析。'
        : msg || 'EPUB 解析失败，请检查文件是否完整。'
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: friendly }),
    }
  }
}
