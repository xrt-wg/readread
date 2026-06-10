# Markdown 渲染升级执行计划

## 阶段划分

```
第一阶段（当前）：HTML → Markdown → ReactMarkdown → UI
第二阶段（按需）：Markdown → AST → 自定义渲染 → 全节点划词支持
```

---

## 第一阶段执行计划

### Step 1：安装依赖

```bash
npm install turndown react-markdown remark-gfm
```

| 包 | 作用 |
|---|---|
| `turndown` | HTML 字符串 → Markdown 字符串 |
| `react-markdown` | Markdown 字符串 → React 节点 |
| `remark-gfm` | 启用 GFM：表格、删除线、任务列表 |

---

### Step 2：封装 Markdown 转换工具

新建 `src/utils/markdownUtils.js`：
- 封装 `htmlToMarkdown(html)` 函数
- 配置 Turndown 规则（保留代码块、移除无意义标签等）
- 暴露 `extractRawText(reactChildren)` 工具函数（供 ReactMarkdown 的 `p` 组件使用）

---

### Step 3：更新提取层

**`src/services/urlImport.js`**：
- 将 `article.textContent` 改为 `article.content`（Readability 净化后的 innerHTML）
- 调用 `htmlToMarkdown(article.content)` 得到 Markdown
- 返回 `{ title, text: article.textContent, markdown }`（同时保留 text 备用）

**`src/components/ImportPage.jsx`** 中的 HTML 文件导入分支：
- 同步改用 `article.content` + Turndown 转换

---

### Step 4：更新存储层

**`src/store/storage.js`** 中的 `createArticle`：
- 新增 `markdown` 字段（可为 null，旧文章兼容）

```js
function createArticle({ title, text, markdown = null }) {
  return {
    id: nanoid(),
    title,
    text,
    markdown,   // 新增
    wordCount: text.trim().split(/\s+/).length,
    createdAt: new Date().toISOString(),
  }
}
```

---

### Step 5：更新渲染层

**`src/components/ReaderPage.jsx`**：
- 检测 `article.markdown` 是否存在
  - 存在：用 ReactMarkdown + 自定义 components 渲染
  - 不存在（旧文章）：降级为现有 `paragraphs.map(ParagraphRenderer)` 路径
- `components.p` 中：用 `extractRawText` 取回文本，传给 ParagraphRenderer
- `components.h1-h4`、`li`、`code`、`blockquote`：样式渲染，暂不支持书签

---

### Step 6：补充排版样式

**`src/index.css`** 新增文章内容样式类：
- `.article-h1/.article-h2/.article-h3`：字号、字重、间距
- `.article-quote`：左边线、斜体
- `.code-block`：等宽字体、背景色
- `.inline-code`：行内代码样式
- 所有样式与现有 `var(--ink)`、`var(--parchment)` 色板保持一致

---

### Step 7：验收测试

| 测试项 | 预期结果 |
|---|---|
| URL 导入一篇有标题和列表的 Blog | 标题层级渲染正确，列表有缩进和项目符号 |
| 正文段落划词翻译 | 功能正常，与升级前无差异 |
| 正文段落收藏书签 | 高亮显示正常，书签面板正常 |
| 旧文章（无 markdown 字段）打开 | 降级渲染，无报错，功能正常 |
| 手动上传纯文本导入 | 正常渲染（无 markdown，走旧路径） |

---

## 第二阶段触发条件

满足以下任一条件时启动：

1. 用户反馈：在列表项或标题内划词是高频需求
2. `extractRawText` 在复杂内联格式（nested bold/link）下出现字符偏移偏差
3. 书签定位出现系统性错误，根因指向 `paragraphIndex` 语义模糊

---

## 第二阶段核心改动（提前规划）

### 数据模型变更

```js
// 书签结构扩展
bookmark: {
  blockIndex: number,      // 在 block 数组中的位置（替代 paragraphIndex）
  blockType: string,       // 'paragraph' | 'listItem' | 'heading' 等
  charOffset: number,      // 在该 block 文本内的字符偏移
  ...
}
```

### 渲染架构

```
Markdown 字符串
    ↓ remark.parse()
AST（mdast）
    ↓ 遍历 block 节点
block[] = [{ type, text, index }, ...]
    ↓
BlockRenderer（每种 type 一个渲染器）
    ├─ ParagraphBlock   → 支持划词 + 书签高亮
    ├─ HeadingBlock     → 支持划词 + 书签高亮
    ├─ ListItemBlock    → 支持划词 + 书签高亮
    └─ CodeBlock        → 不支持划词
```

### 迁移策略

- 旧书签（`paragraphIndex` 坐标系）需要一次性迁移脚本：
  扫描文章 Markdown，将第 N 个 `paragraph` block 的索引映射为新 `blockIndex`
- 迁移在首次打开旧文章时自动执行，结果重写 localStorage

---

## 风险记录

| 风险 | 等级 | 应对 |
|---|---|---|
| Turndown 对某些 Blog 的 HTML 转换质量差 | 中 | 预留手动上传兜底路径 |
| `extractRawText` 在复杂内联格式下偏差 | 中 | 第二阶段 AST 方案根治 |
| 旧书签在 Markdown 段落重排后偏移失效 | 低 | 旧文章降级渲染，不经过 Markdown 路径 |
| react-markdown bundle size 增加 | 低 | 约 +80KB，可接受 |
