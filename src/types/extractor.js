/**
 * 提取器接口类型定义
 *
 * 提取器负责从原始格式提取结构化内容。
 * 不负责生成系统 id、推导 parentId、计算 wordCount —
 * 这些由 createDocument() 工厂函数统一完成。
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ExtractionResult
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ExtractionResult
 *           提取器的统一输出。
 *
 * @property {ExtractionMeta} meta
 *           文档元信息。
 *
 * @property {ExtractionSection[]} sections
 *           按文档顺序排列的节列表。
 *           不包含 id 和 parentId — 由工厂函数分配和推导。
 */

/**
 * @typedef {Object} ExtractionMeta
 *
 * @property {string} title
 * @property {string|null} [author]
 * @property {import('./document').DocumentFormat} format
 * @property {string|null} [coverUrl]
 * @property {string} [lang]
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ExtractionSection
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ExtractionSection
 *           提取器产出的 section 片段。
 *           注意: 不包含 id 和 parentId —
 *           id 由工厂函数分配 ("s_" + index)，
 *           parentId 由 deriveParentIds() 根据 depth 推导。
 *
 * @property {string|null} heading
 *           节标题。null 表示该节无标题。
 *
 * @property {number} depth
 *           层级深度。0 = 顶层，1 = 第二层，2 = 第三层。
 *           由提取器从原始格式的标题层级推导（EPUB toc、Markdown ##）。
 *
 * @property {number} order
 *           在文档顺序中的排序序号，从 0 开始递增。
 *
 * @property {ExtractionSectionBody} body
 *           本节正文。
 */

/**
 * @typedef {Object} ExtractionSectionBody
 *
 * @property {string} text
 *           纯文本正文。
 *
 * @property {string|null} markdown
 *           富文本格式正文。纯文本时可为 null。
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Extractor
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ExtractorInput
 *           提取器输入。使用 buffer 而非 File — 确保接口可复用于后端环境。
 *
 * @property {'url'|'buffer'|'text'} type
 * @property {string} [url]
 *           type='url' 时必填。
 * @property {ArrayBuffer} [buffer]
 *           type='buffer' 时必填。
 * @property {string} [fileName]
 *           type='buffer' 时必填。
 * @property {string} [mimeType]
 *           type='buffer' 时必填。
 * @property {string} [text]
 *           type='text' 时必填。
 * @property {string} [title]
 *           type='text' 时可选，文档标题。
 */

/**
 * @callback Extractor
 * @param {ExtractorInput} input
 * @param {AbortSignal} [signal]
 * @returns {Promise<ExtractionResult>}
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 前端适配：File → ExtractorInput
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 将浏览器 File 对象转换为 ExtractorInput (buffer 变体)。
 *
 * @param {File} file — 浏览器 File 对象
 * @returns {Promise<ExtractorInput>}
 */
export async function fileToExtractorInput(file) {
  const buffer = await file.arrayBuffer()
  return {
    type:     'buffer',
    buffer,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
  }
}
