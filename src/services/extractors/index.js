/**
 * 提取器接口 — EXTRACTORS 注册表 + Document 工厂函数
 *
 * 提取器职责：从原始格式提取结构化内容，返回 ExtractionResult。
 * 工厂函数职责：从 ExtractionResult 装配完整 Document（分配 id、推导 parentId、计算 wordCount）。
 */

// ─── 工厂函数 ──────────────────────────────────────────────────────────────────

/**
 * 从 ExtractionResult 装配完整的 Document 对象。
 *
 * @param {import('../../types/extractor').ExtractionResult} result
 * @returns {import('../../types/document').Document}
 */
export function createDocument(result) {
  const sections = result.sections.map((s, i) => ({
    id:       `s_${i}`,
    heading:  s.heading,
    depth:    s.depth,
    parentId: null,                     // 下一步由 deriveParentIds 填充
    order:    s.order,
    body: {
      text:      s.body.text,
      markdown:  s.body.markdown,
      wordCount: s.body.text.split(/\s+/).filter(Boolean).length,
    },
  }))

  deriveParentIds(sections)

  return {
    id:             generateDocumentId(),
    title:          result.meta.title,
    author:         result.meta.author ?? null,
    format:         result.meta.format,
    coverUrl:       result.meta.coverUrl ?? null,
    lang:           result.meta.lang ?? 'auto',
    sourceUrl:      null,
    sections,
    totalWordCount: sections.reduce((sum, s) => sum + s.body.wordCount, 0),
    sectionCount:   sections.length,
    createdAt:      new Date().toISOString(),
  }
}

/**
 * 根据 depth 推导每个 section 的 parentId。
 * 规则：向前找最近的 depth 更小的 section，若存在则为父节点，否则为 null。
 *
 * 前提：sections 数组必须按文档顺序排列（order 递增）。
 *
 * @param {import('../../types/document').Section[]} sections — 原地修改
 */
export function deriveParentIds(sections) {
  const stack = []  // [{ id, depth }]
  for (const section of sections) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= section.depth) {
      stack.pop()
    }
    section.parentId = stack.length > 0 ? stack[stack.length - 1].id : null
    stack.push(section)
  }
}

function generateDocumentId() {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// ─── 提取器注册表 ──────────────────────────────────────────────────────────────

import { extractFromUrl } from './urlExtractor'
import { extractFromPastedText } from './pasteExtractor'
import { extractFromMarkdownFile } from './markdownExtractor'
import { extractFromHtmlFile } from './htmlExtractor'
import { extractFromEpub } from './epubExtractor'

/**
 * @type {Record<string, import('../../types/extractor').Extractor|null>}
 */
export const EXTRACTORS = {
  url:       extractFromUrl,
  paste:     extractFromPastedText,
  markdown:  extractFromMarkdownFile,
  html:      extractFromHtmlFile,
  epub:      extractFromEpub,
  pdf:       null,   // 预留
}
