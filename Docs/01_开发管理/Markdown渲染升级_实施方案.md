# Markdown 渲染升级实施方案

## 背景与问题

当前阅读器的内容渲染流程：

```
article.text (textContent) → split(/\n+/) → ParagraphRenderer × n
```

Readability 提取的 `textContent` 丢弃了所有 HTML 结构信息（标题层级、列表、代码块等），
导致导入后的文章排版与原文差异较大，影响阅读体验。

---

## 目标

在不破坏现有划词、书签、高亮核心功能的前提下，提升导入文章的排版质量，
使标题、列表、代码块等结构元素能够被正确识别并渲染。

---

## 方案概述：两阶段升级

### 第一阶段：HTML → Markdown → ReactMarkdown

**核心思路**：
- 提取层：Readability 改用 `article.content`（净化后的 innerHTML），再通过 Turndown 转为 Markdown 字符串
- 存储层：`article` 数据结构新增 `markdown` 字段，保留 `text` 字段作为纯文本备用
- 渲染层：用 ReactMarkdown 替代当前的 `paragraphs.map(ParagraphRenderer)` 结构
- 兼容层：通过 ReactMarkdown 的 `components` prop，对 `<p>` 节点保留现有 ParagraphRenderer 逻辑

**核心设计：`components` 分层接管**

```jsx
<ReactMarkdown components={{
  p: ({ children }) => (
    <ParagraphRenderer
      text={extractRawText(children)}
      bookmarks={matchedBookmarks}
    />
  ),
  h1: ({ children }) => <h1 className="article-h1">{children}</h1>,
  h2: ({ children }) => <h2 className="article-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="article-h3">{children}</h3>,
  li: ({ children }) => <li>{children}</li>,
  code: ({ node, inline, children }) =>
    inline
      ? <code className="inline-code">{children}</code>
      : <pre><code className="code-block">{children}</code></pre>,
  blockquote: ({ children }) => <blockquote className="article-quote">{children}</blockquote>,
}} />
```

```js
// 从 React children 中提取纯文本（用于传入 ParagraphRenderer）
function extractRawText(children) {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(extractRawText).join('')
  if (children?.props?.children) return extractRawText(children.props.children)
  return ''
}
```

**第一阶段的已知边界**：

| 功能 | 支持情况 |
|---|---|
| 正文段落划词 / 书签 / 高亮 | ✅ 完整保留 |
| 标题、列表、代码块渲染 | ✅ 结构正确 |
| 标题内 / 列表项内划词 | ❌ 暂不支持 |
| 旧文章（纯文本存储）兼容 | ✅ 降级为纯文本渲染 |

---

### 第二阶段：AST Block-based 自定义渲染（按需启动）

**触发条件**：第一阶段上线后，发现列表项/标题内划词需求显著，或 `extractRawText` 在复杂内联格式下出现偏差。

**核心思路**：
- 存储 Markdown AST（或结构化 block 数组）而非 Markdown 字符串
- 每个 block 作为独立可寻址单元
- 书签定位从 `{ paragraphIndex, charOffset }` 扩展为 `{ blockIndex, blockType, charOffset }`
- 每种 block 类型有独立渲染器，均支持划词与高亮

**数据结构变化**：

```js
// 当前
bookmark: { paragraphIndex: 3, charOffset: 22, ... }

// 第二阶段
bookmark: { blockIndex: 5, blockType: 'paragraph', charOffset: 22, ... }
```

---

## 技术依赖

| 库 | 用途 | 版本建议 |
|---|---|---|
| `turndown` | HTML → Markdown 转换 | ^7.x |
| `react-markdown` | Markdown → React 渲染 | ^9.x |
| `remark-gfm` | 支持 GFM 扩展（表格、删除线等） | ^4.x |

---

## 存储结构变更

```js
// 现有 article 结构
{ id, title, text, wordCount, createdAt }

// 升级后
{
  id, title,
  text,         // 保留：纯文本，用于旧版兼容 + 全文搜索备用
  markdown,     // 新增：Markdown 字符串，渲染主用
  wordCount, createdAt
}
```

旧文章（无 `markdown` 字段）自动降级：以 `text` 渲染，无结构样式，功能不受影响。

---

## 受影响的文件

| 文件 | 变更说明 |
|---|---|
| `src/services/urlImport.js` | 改用 `article.content`，新增 Turndown 转换 |
| `src/components/ImportPage.jsx` | handleFile HTML 分支同步改用 Turndown |
| `src/store/storage.js` | `createArticle` 新增 `markdown` 字段 |
| `src/components/ReaderPage.jsx` | 渲染层替换为 ReactMarkdown + components |
| `src/components/ParagraphRenderer.jsx` | 不改动，继续作为 `p` 节点的渲染器 |
| `src/index.css` | 新增 article 排版样式（标题、列表、代码块） |
