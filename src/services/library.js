/**
 * 阅读库服务 — 兼容层
 *
 * 迁移后所有实现已移至 readings.js，本文件保留为 re-export 兼容层。
 * 旧代码无需修改 import 路径即可继续工作。
 *
 * @deprecated 新代码请直接 import from './readings'
 */

export {
  listArticles,
  saveArticle,
  deleteArticle,
  listBookmarksByArticle,
  listAllBookmarks,
  listDueBookmarks,
  saveBookmark,
  deleteBookmark,
  getReadingMark,
  listReadingMarks,
  saveReadingMark,
  clearReadingMark,
  setReadingMarkCompleted,
  loadLibrarySnapshot,
  exportLibraryData,
  importLibraryData,
} from './readings'
