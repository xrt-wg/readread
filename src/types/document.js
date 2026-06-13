/**
 * Document & Section 类型定义
 *
 * 统一文档对象模型的核心类型。
 * 使用 JSDoc @typedef 提供 IDE 类型提示，项目保持纯 JavaScript。
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Document
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} Document
 *
 * @property {string} id
 *           文档唯一标识。
 *           新建文档格式: "doc_" + Date.now() + "_" + random5chars。
 *           已有 "art_" 前缀保持不变，不做批量重命名。
 *
 * @property {string} title
 *           文档标题，必选。不可为空字符串。
 *
 * @property {string|null} author
 *           作者。EPUB 可从 metadata 提取，其他格式为 null。
 *           默认值: null。
 *
 * @property {DocumentFormat} format
 *           来源格式。允许值见 DocumentFormat 类型。
 *
 * @property {string|null} coverUrl
 *           封面图。EPUB 提取为 base64 data URL（Canvas 缩放 max 300px）。
 *           格式: "data:image/jpeg;base64,..."。
 *           默认值: null。
 *
 * @property {string} lang
 *           文档语言。默认值: 'auto'。
 *           'auto' 时后续可根据 navigator.language 或文本内容推断。
 *
 * @property {string|null} sourceUrl
 *           来源 URL。URL 导入时记录原始地址；其他格式为 null。
 *           默认值: null。
 *
 * @property {Section[]} sections
 *           平铺的一级数组。始终至少包含 1 个 section。
 *           单 section 文档: [{ id: "s_main", heading: null, ... }]。
 *
 * @property {number} totalWordCount
 *           sum(section.body.wordCount)。整数 >= 0。
 *
 * @property {number} sectionCount
 *           sections.length。整数 >= 1。
 *
 * @property {string} createdAt
 *           ISO 8601 格式。如 "2026-06-13T10:30:00.000Z"。
 *
 * @property {string|null} updatedAt
 *           ISO 8601 格式。默认值: null。
 */

/**
 * @typedef {'url'|'epub'|'pdf'|'paste'|'markdown'|'html'} DocumentFormat
 *
 *   'url'       — URL 导入的文章
 *   'epub'      — EPUB 书籍
 *   'pdf'       — PDF 文档（预留，当前未实现）
 *   'paste'     — 粘贴的纯文本
 *   'markdown'  — Markdown 文件
 *   'html'      — HTML 文件
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Section
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} Section
 *
 * @property {string} id
 *           节 ID，在 document.sections 数组内唯一。
 *           格式: "s_" + 序号，如 "s_0", "s_1"。
 *
 * @property {string|null} heading
 *           节标题。如 "Chapter 1: The Beginning"。
 *           null 表示该节无标题。
 *           标题为纯文本，不包含 Markdown 语法。
 *
 * @property {number} depth
 *           层级深度。0 = 顶层（章），1 = 第二层（节），2 = 第三层（小节）。
 *           必须 >= 0。
 *
 * @property {string|null} parentId
 *           父节的 id。null 表示顶层节点。
 *           由 createDocument() 工厂函数中的 deriveParentIds() 推导生成。
 *
 * @property {number} order
 *           在文档顺序中的排序序号，从 0 开始。
 *           sections 数组中 order 按文档出现顺序递增。
 *
 * @property {SectionBody} body
 *           本节正文。
 */

/**
 * @typedef {Object} SectionBody
 *
 * @property {string} text
 *           纯文本正文。始终存在，可为空字符串（纯容器节点）。
 *
 * @property {string|null} markdown
 *           富文本格式正文。可为 null（纯文本、PDF 提取）。
 *           当不为 null 时，应为有效的 Markdown 字符串。
 *
 * @property {number} wordCount
 *           本节词数。计算方式: text.split(/\s+/).filter(Boolean).length。
 *           整数 >= 0。
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 兼容性映射
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 将旧 Article 对象映射为新 Document。
 * 保留原始 id（不重命名 art_ → doc_）。
 *
 * @param {Object} article — 旧 Article 对象 { id, title, text, markdown, wordCount, createdAt, updatedAt }
 * @returns {Document}
 */
export function migrateArticleToDocument(article) {
  const wordCount =
    article.wordCount ??
    article.text?.split(/\s+/).filter(Boolean).length ??
    0

  return {
    id:             article.id,
    title:          article.title,
    author:         null,
    format:         'paste',
    coverUrl:       null,
    lang:           'auto',
    sourceUrl:      article.sourceUrl ?? null,
    sections:       buildSingleSection(article.text ?? '', article.markdown ?? null, wordCount),
    totalWordCount: wordCount,
    sectionCount:   1,
    createdAt:      article.createdAt,
    updatedAt:      article.updatedAt ?? null,
  }
}

/**
 * 为单 section 文档构建 sections 数组。
 *
 * @param {string} text
 * @param {string|null} markdown
 * @param {number} wordCount
 * @returns {Section[]}
 */
function buildSingleSection(text, markdown, wordCount) {
  return [
    {
      id:        's_main',
      heading:   null,
      depth:     0,
      parentId:  null,
      order:     0,
      body: {
        text,
        markdown,
        wordCount,
      },
    },
  ]
}
