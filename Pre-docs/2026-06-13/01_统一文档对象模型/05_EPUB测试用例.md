# EPUB 提取器测试用例

- **日期**：2026-06-13
- **测试对象**：`src/services/extractors/epubExtractor.js`（epub2MD 适配层）
- **通过标准**：8 个用例中至少 7 个通过（用例 8 为错误处理用例，至少不崩溃）

---

## 一、测试准备

### 1.1 测试环境

- Chrome/Edge 最新版（epub2MD 依赖 fflate，需浏览器环境）
- 测试 EPUB 文件放在 `test/fixtures/epub/` 目录下

### 1.2 测试工具函数

```js
/**
 * 从 fixture 路径加载 EPUB 文件并调用提取器。
 * @param {string} fixturePath
 * @returns {Promise<{ document: Document, result: ExtractionResult }>}
 */
async function loadAndExtract(fixturePath) {
  const res = await fetch(fixturePath)
  const buffer = await res.arrayBuffer()
  const fileName = fixturePath.split('/').pop()
  const mimeType = 'application/epub+zip'
  const result = await extractFromEpub(
    { type: 'buffer', buffer, fileName, mimeType }
  )
  const document = createDocument(result)
  return { document, result }
}
```

---

## 二、测试用例

### 用例 1：标准 EPUB3（小说）

**测试文件**：`test/fixtures/epub/01_standard_epub3.epub`（如 Project Gutenberg 导出的 EPUB3 小说）

**验证清单**：

| # | 验证项 | 预期结果 | 实际 |
|---|--------|---------|------|
| 1.1 | `document.title` | 非空，与 EPUB metadata title 一致 | |
| 1.2 | `document.author` | 非空，与 EPUB metadata author 一致 | |
| 1.3 | `document.format` | `"epub"` | |
| 1.4 | `document.sectionCount` | >= 2 | |
| 1.5 | `sections[0].heading` | 非 null，对应第一章标题 | |
| 1.6 | 所有 `sections[].depth` 在同一层级时 | 全部为 0（小说通常无子节） | |
| 1.7 | `sections[].parentId` | depth=0 → 全部为 null | |
| 1.8 | `sections[].body.text` | 非空，可读英文 | |
| 1.9 | `sections[].body.markdown` | 非空，包含段落文本 | |
| 1.10 | `sections[].body.wordCount` | > 0，与实际词数一致 | |
| 1.11 | `totalWordCount` | 各 section wordCount 之和 | |
| 1.12 | `document.lang` | 应为 `"en"`（从 EPUB metadata 读取） | |

---

### 用例 2：EPUB2（旧格式 Ncx TOC）

**测试文件**：`test/fixtures/epub/02_epub2_ncx.epub`（EPUB2 格式，使用 NCX 而非 NAV 目录）

**验证清单**：

| # | 验证项 | 预期结果 | 实际 |
|---|--------|---------|------|
| 2.1 | `document.title` | 非空 | |
| 2.2 | `sections[].heading` | 从 NCX navPoint 正确提取 | |
| 2.3 | `sectionCount` | >= 1 | |
| 2.4 | sections 数组不为空 | ✅ | |
| 2.5 | 无 JS 错误（NCX 解析路径走到容错分支） | 控制台无红色报错 | |

---

### 用例 3：无 TOC 的 EPUB（降级测试）

**测试文件**：`test/fixtures/epub/03_no_toc.epub`（EPUB 缺少标准的 toc.ncx 或 nav.xhtml）

**验证清单**：

| # | 验证项 | 预期结果 | 实际 |
|---|--------|---------|------|
| 3.1 | `sectionCount` | >= 1（spine 中的章节数） | |
| 3.2 | 所有 `sections[].depth` | 全部为 0（spine 平铺，无法知道层级） | |
| 3.3 | `sections[].heading` | 可为 null 或从内容中提取的标题 | |
| 3.4 | 无 JS 错误或崩溃 | ✅ | |

---

### 用例 4：中文 EPUB

**测试文件**：`test/fixtures/epub/04_chinese.epub`（中文小说或技术书）

**验证清单**：

| # | 验证项 | 预期结果 | 实际 |
|---|--------|---------|------|
| 4.1 | `document.title` | 中文标题，正确显示（无乱码） | |
| 4.2 | `sections[].heading` | 中文章节标题，无乱码 | |
| 4.3 | `sections[].body.text` | 中文正文正确显示 | |
| 4.4 | `document.lang` | 应为 `"zh"` 或从 EPUB metadata 读取 | |
| 4.5 | 中英文之间空格 | epub2MD autocorrect 自动处理（如有英文混排） | |

---

### 用例 5：多级嵌套 TOC（技术书）

**测试文件**：`test/fixtures/epub/05_nested_toc.epub`（技术类 EPUB，包含 Part → Chapter → Section → Subsection）

**验证清单**：

| # | 验证项 | 预期结果 | 实际 |
|---|--------|---------|------|
| 5.1 | `sectionCount` | 与 TOC 叶子节点数量一致 | |
| 5.2 | sections 中 depth 值分布 | 至少出现 depth 0, 1, 2 三种值 | |
| 5.3 | `deriveParentIds` 输出正确 | 每个 depth > 0 的 section 的 parentId 不等于 null | |
| 5.4 | parentId 指向正确的父 section | 父 section 的 depth = 当前 section.depth - 1（或最近的更浅层级） | |
| 5.5 | 取 depth=2 的 section → parentId 回查 | parentId 指向的 section.depth < 2 且 order < 当前 order | |
| 5.6 | `buildTocTree` 结果 | 树结构可生成，无报错 | |

---

### 用例 6：含封面图的 EPUB

**测试文件**：`test/fixtures/epub/06_with_cover.epub`（含封面图的 EPUB）

**验证清单**：

| # | 验证项 | 预期结果 | 实际 |
|---|--------|---------|------|
| 6.1 | `document.coverUrl` | 非 null，以 `data:image/` 开头 | |
| 6.2 | 封面图格式 | `data:image/jpeg;base64,...` 或 `data:image/png;base64,...` | |
| 6.3 | 封面图尺寸 | 宽/高 ≤ 300px（经 Canvas 缩放后） | |
| 6.4 | 封面图可显示 | 在 `<img src={coverUrl}>` 中正常渲染 | |
| 6.5 | 封面图大小 | < 100KB（base64 编码后） | |

---

### 用例 7：含内嵌图片的 EPUB

**测试文件**：`test/fixtures/epub/07_with_images.epub`（章节内含有插图、截图、图表的 EPUB）

**验证清单**：

| # | 验证项 | 预期结果 | 实际 |
|---|--------|---------|------|
| 7.1 | 小图（< 50KB）→ base64 嵌入 | body.markdown 中有 `![](data:image/...)` | |
| 7.2 | 大图（≥ 50KB）→ 占位符 | body.markdown 中有 `[Image: alt_text]` | |
| 7.3 | `body.text` 不含图片 base64 | 图片 base64 只出现在 markdown 中 | |
| 7.4 | 透明背景 UI 装饰图被过滤 | 不生成占位符或 base64 嵌入 | |
| 7.5 | JSONB sections 总大小 | < 5MB（确保可存入 Supabase JSONB 列） | |

---

### 用例 8：损坏/DRM EPUB（错误处理）

**测试文件**：
- `test/fixtures/epub/08a_corrupted.epub`（损坏的 ZIP/EPUB）
- `test/fixtures/epub/08b_drm.epub`（受 DRM 保护的 EPUB，如有）

**验证清单**：

| # | 验证项 | 预期结果 | 实际 |
|---|--------|---------|------|
| 8.1 | 损坏 EPUB → 抛出 Error | error.message 包含可用信息（非 `undefined`） | |
| 8.2 | DRM EPUB → 明确提示 | "该 EPUB 受 DRM 保护或已损坏，无法导入" | |
| 8.3 | ImportPage 错误展示 | 显示 error.message，不白屏不崩溃 | |
| 8.4 | 错误后可正常导入其他格式 | 不影响后续 URL/粘贴/HTML 导入 | |

---

## 三、性能测试

| # | 测试场景 | 目标 | 实际 |
|---|---------|------|------|
| P-1 | 50 页 EPUB 提取时间 | < 3 秒 | |
| P-2 | 200 页 EPUB 提取时间 | < 15 秒 | |
| P-3 | epub2MD 动态 import 加载时间 | < 500ms（含 fflate） | |
| P-4 | 提取期间 UI 响应性 | 不阻塞主线程 > 500ms | |

---

## 四、整合测试

| # | 测试场景 | 预期 | 实际 |
|---|---------|------|------|
| I-1 | EPUB 导入 → 阅读页可正常阅读 | ✅ | |
| I-2 | 切换章节 → 收藏 → 回顾面板展示 section 来源 | ✅ | |
| I-3 | 导出含 EPUB Document 的备份 → 重新导入 | 所有 section 正确恢复 | |
| I-4 | EPUB Document 在文章库列表中显示章节数 | ✅ | |
