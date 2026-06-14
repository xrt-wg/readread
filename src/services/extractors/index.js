/**
 * 提取器接口 — EXTRACTORS 注册表 + Document 工厂函数
 *
 * 提取器职责：从原始格式提取结构化内容，返回 ExtractionResult。
 * 工厂函数职责：从 ExtractionResult 装配完整 Document（分配 id、推导 parentId、计算 wordCount）。
 */

// ─── 共享工具函数 ──────────────────────────────────────────────────────────────

/**
 * 从 ExtractionSection 数组装配完整的 Section 数组。
 * 职责：分配 id、计算 wordCount。
 * 注意：parentId 先置为 null，由 deriveParentIds 单独推导。
 *
 * @param {import('../../types/extractor').ExtractionSection[]} extractionSections
 * @returns {import('../../types/document').Section[]}
 */
export function assembleSections(extractionSections) {
  return extractionSections.map((s, i) => ({
    id:       `s_${i}`,
    heading:  s.heading,
    depth:    s.depth,
    parentId: null,
    order:    s.order,
    body: {
      text:      s.body.text,
      markdown:  s.body.markdown,
      wordCount: s.body.text.split(/\s+/).filter(Boolean).length,
    },
  }))
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

/**
 * 生成业务 ID。
 * @param {string} prefix — 前缀，如 'doc_'、'imp_'
 * @returns {string}
 */
export function generateId(prefix) {
  return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// ─── 工厂函数 ──────────────────────────────────────────────────────────────────

/**
 * 从 ExtractionResult 装配完整的 Document 对象。
 *
 * @param {import('../../types/extractor').ExtractionResult} result
 * @returns {import('../../types/document').Document}
 */
export function createDocument(result) {
  const sections = assembleSections(result.sections)

  deriveParentIds(sections)

  const fullText = sections.map(s => s.body.text).filter(Boolean).join('\n\n')
  const fullMarkdown = sections.some(s => s.body.markdown != null)
    ? sections.map(s => s.body.markdown ?? s.body.text).join('\n\n')
    : null

  return {
    id:             generateId('doc_'),
    title:          result.meta.title,
    text:           fullText,
    markdown:       fullMarkdown,
    author:         result.meta.author ?? null,
    format:         result.meta.format,
    coverUrl:       result.meta.coverUrl ?? null,
    lang:           result.meta.lang ?? 'auto',
    sourceUrl:      result.meta.sourceUrl ?? null,
    sections,
    totalWordCount: sections.reduce((sum, s) => sum + s.body.wordCount, 0),
    sectionCount:   sections.length,
    createdAt:      new Date().toISOString(),
    updatedAt:      null,
  }
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
