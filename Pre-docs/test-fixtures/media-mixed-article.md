## 第一章 · 排版与文字

这是一段**加粗**与*斜体*混排的开场白，用来验证工具栏插入的 `**` 和 `*` 语法在预览与阅读页的表现。这一段也可以随手圈选几个单词做成 word 收藏，验证背景层高亮。

Reading is not merely decoding symbols; it is a dialogue across time. 这句英文里夹着一个[行内链接](https://www.example.com/article)，链接应该与正文同色、只带一个小图标，鼠标悬停时图标变亮并能显示目标地址。

下面是一个裸地址，依靠 GFM 自动识别为链接：https://www.example.com/plain-url

行内代码 `const x = 1` 也应该与正文区分开。

## 第二章 · 图片与图注

本章集中验证图片管线：居中、限高、图注、降级、图文混排。所有图片都是占位图，可以直接替换成你的真实图片地址。

### 横版图片（带图注）

![横版配图：这里应该显示在图片下方居中](https://images--1.oss-cn-beijing.aliyuncs.com/pic3/image-20260918115459315.png)

### 无图注图片

![](https://images--1.oss-cn-beijing.aliyuncs.com/pic3/image-20260918103815019.png)

上面这张没有写说明文字，图片下方应该是干净的，没有任何残留空白说明行。

### 竖长图（验证 82vh 限高）

![竖长图：不应铺满整屏，点击查看原图](https://images--1.oss-cn-beijing.aliyuncs.com/pic3/image-20260918102935086.png)

### 超宽图（验证 max-width 自适应）

![超宽图：应收缩到正文宽度](https://images--1.oss-cn-beijing.aliyuncs.com/pic3/image-20260918102536388.png)

### 图文混排段落

这段文字开头有一张图 ![混排小图](https://images--1.oss-cn-beijing.aliyuncs.com/pic3/image-20260917160123961.png) ，图后面还跟着文字。请在这一段上做一次 phrase 或 sentence 收藏——收藏高亮、阅读标记按钮、图片三者应该共存互不干扰，这是本次改造的重点回归项。

### 失效图片（验证降级）

![这张图加载失败：图片应自动隐藏，只保留这行图注](https://images--1.oss-cn-beijing.aliyuncs.com/pic3/image-20260206102242383.png)

### 可点击的图片链接

[![这张图片被包在链接里：点击应跳转链接而不是打开原图，且不带链接小图标](https://images--1.oss-cn-beijing.aliyuncs.com/pic3/image-20260206102224255.png)

## 第三章 · 列表与引用

无序列表，第二项里带链接：

- 第一项，普通文字
- 第二项，含[列表内链接](https://images--1.oss-cn-beijing.aliyuncs.com/pic3/20251221013851.png)
- 第三项，含一张小图 ![列表内小图](https://images--1.oss-cn-beijing.aliyuncs.com/pic3/20251014201259.png)

有序列表：

1. 第一步：打开编辑器
2. 第二步：粘贴本文
3. 第三步：对照检查清单逐项验证

> 引用块里也可以有[链接](https://images--1.oss-cn-beijing.aliyuncs.com/pic3/20251014194240.png)，引用块应该保持金色左边条与斜体样式。

## 第四章 · 收藏压测

This paragraph is intentionally long so you can test every bookmark type in one place. Pick a single word like *serendipity* for a word bookmark; select a short phrase such as "a quiet corner of the library" for a phrase bookmark; select one whole sentence for a sentence bookmark with its indigo underline; and finally select across two sentences to verify that overlapping ranges resolve gracefully without visual glitches. The rain fell softly against the window while the old lamp hummed, and somewhere between the second and third cup of tea the chapter finally began to make sense. When you hover each highlight, the bookmark popover should appear for the innermost range first, and moving onto plain text should dismiss it cleanly.

### 代码块

```js
// 代码块应保持等宽字体与滚动，不被分段管线影响
function greet(name) {
  return `Hello, ${name}!`
}
```

#### 四级标题（depth 2，验证目录层级）

这是最深一级的章节，编辑器左侧目录里应该能看到完整的层级缩进。
