/**
 * 书架服务 — 兼容层
 *
 * 迁移后核心实现已移至 readings.js，本文件保留为 re-export 兼容层。
 *
 * countImportReferences / copyToReadingZone / deleteImportItem 已废弃——
 * 合并后的单表模型不再有跨表参考计数和深拷贝操作。
 *
 * @deprecated 新代码请直接 import from './readings'
 */

export {
  createImportItem,
  fetchImportItems,
  fetchImportItemById,
} from './readings'

// 别名映射：旧 API updateImportItem → readings.updateReading
export { updateReading as updateImportItem } from './readings'

/**
 * @deprecated 合并后不再有跨表参考——所有内容在同一张 readings 表中。
 *             返回值固定为 0。
 */
export async function countImportReferences(_importItemId) {
  return 0
}

/**
 * @deprecated 合并后无需深拷贝——直接调用 startReading() 即可开始阅读。
 *             本函数保留以兼容旧代码，实际等同于 startReading + 兼容返回。
 */
export async function deleteImportItem(_importItemId) {
  throw new Error('deleteImportItem 已废弃，请使用 deleteReading')
}

/**
 * @deprecated 合并后无需从书架区拷贝到阅读区——直接调用 startReading() 即可。
 *             本函数保留以兼容旧代码，实际做状态更新而非创建新实体。
 */
export async function copyToReadingZone(importItem, { canUseCloudLibrary }) {
  const { startReading, getReading } = await import('./readings')
  await startReading(importItem.id, { canUseCloudLibrary, userId: importItem.userId })
  return getReading(importItem.id, { canUseCloudLibrary, userId: importItem.userId })
}

/**
 * @deprecated 合并后所有内容在同一张表中，不再需要按 ID 批量回查标题。
 *             返回空 Map 以兼容旧调用方。
 */
export async function fetchImportItemTitlesByIds(_ids) {
  return new Map()
}
