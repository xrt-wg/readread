/**
 * Bookmark & ReadingProgress 类型定义
 *
 * 下游引用模型的类型约束。
 * 使用 JSDoc @typedef 提供 IDE 类型提示，项目保持纯 JavaScript。
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Bookmark
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} Bookmark
 *
 * @property {string} id
 *           收藏唯一标识。格式: "bm_" + timestamp + random5。
 *
 * @property {string} documentId
 *           所属文档 ID（即原来的 articleId）。
 *
 * @property {string|null} sectionId
 *           所属 section.id。null 时视为 "s_main"。
 *
 * @property {string|null} sectionHeading
 *           section.heading 的快照，写入时同步。
 *           陈旧策略: write-time snapshot。读取时优先使用此值，
 *           若为空则回退查询 document.sections 中对应 section 的 heading。
 *
 * @property {number} paragraphIndex
 *           section 内的局部段落索引，从 0 开始。
 *           单 section 文档中与旧值语义一致。
 *
 * @property {number} charOffset
 *           段落内字符偏移量。
 *
 * @property {'word'|'phrase'|'sentence'|'paragraph'} type
 *           收藏类型。
 *
 * @property {string} text
 *           收藏原文。
 *
 * @property {string|null} translation
 *           翻译结果。
 *
 * @property {string|null} contextSentence
 *           所在完整句子原文（word/phrase 类型有值）。
 *
 * @property {string|null} contextTranslation
 *           所在句子的译文。
 *
 * @property {'pending'|'done'|'error'} translationStatus
 *           翻译状态。
 *
 * @property {number} reviewCount
 *           复习次数。默认 0。
 *
 * @property {string|null} nextReviewAt
 *           下次复习时间（ISO 8601）。null 表示未排期。
 *
 * @property {number} familiarity
 *           熟悉度 0-5。默认 0。
 *
 * @property {string} createdAt
 *           创建时间（ISO 8601）。
 *
 * @property {string|null} updatedAt
 *           更新时间（ISO 8601）。
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ReadingProgress
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ReadingProgress
 *
 * @property {string} documentId
 *           所属文档 ID。
 *
 * @property {string|null} sectionId
 *           当前阅读所在的 section.id。null 时视为 "s_main"。
 *           completed = true 时可为 null。
 *
 * @property {number|null} paragraphIndex
 *           section 内的段落索引。null 表示未设置阅读标记。
 *
 * @property {string[]} completedSections
 *           已读完的 section.id 列表。
 *           语义:
 *           - 用户在 section 阅读进度 >= 90% → 加入列表
 *           - 用户回到已完成 section 重新阅读 → 移出列表
 *           - 用户显式点击"标记已读完" → 全 section 加入 + completed = true
 *           - completedSections.length === document.sectionCount → completed 自动 true
 *           空数组 + completed = true → 兼容旧数据，全文已读完。
 *
 * @property {boolean} completed
 *           全文是否已读完。
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 兼容性工具
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 安全获取 sectionId。兼容旧 bookmark/readingMark（无 sectionId 字段）。
 *
 * @param {Object} record — bookmark 或 readingMark 对象
 * @param {string|null} [record.sectionId]
 * @returns {string}
 */
export function resolveSectionId(record) {
  return record?.sectionId || 's_main'
}

/**
 * 安全获取 sectionHeading。
 * 优先使用 bookmark 中存储的快照；为空时回退查询 document.sections。
 *
 * @param {Object} record — bookmark 对象
 * @param {string|null} [record.sectionHeading]
 * @param {string|null} [record.sectionId]
 * @param {import('./document').Document} [document]
 * @returns {string|null}
 */
export function resolveSectionHeading(record, document) {
  if (record?.sectionHeading) return record.sectionHeading
  if (!document) return null
  const sectionId = resolveSectionId(record)
  const section = document.sections?.find(s => s.id === sectionId)
  return section?.heading ?? null
}
