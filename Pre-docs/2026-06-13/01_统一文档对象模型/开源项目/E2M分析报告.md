# E2M (Everything to Markdown) 分析报告

- **分析日期**：2026-06-13
- **项目地址**：https://github.com/wisupai/e2m
- **版本**：0.1.63
- **许可**：MIT
- **语言**：Python 3.10-3.12

---

## 一、项目概述

E2M 是一个 Python 库，目标是将任意格式文件转换为 Markdown。采用 **Parser + Converter** 双层架构：

```
输入文件 → Parser（提取 text + images）→ Converter（LLM 清洗）→ Markdown
```

- **Parser**：从文件中提取原始文本和图片数据
- **Converter**：通过 LLM（litellm / zhipuai）将原始数据"修复"为规范 Markdown

---

## 二、Parser 能力矩阵

| 格式 | 可用引擎 | 底层依赖 | 输出质量 | 章节结构 |
|------|---------|---------|---------|---------|
| **EPUB** | unstructured | `unstructured.partition_epub` + `ebooklib` | 中 | ❌ 丢失——所有文本拼接为一个字符串 |
| **PDF** | unstructured | `unstructured.partition_pdf` | 中 | ❌ 丢失 |
| **PDF** | marker | `marker-pdf` (基于 surya) | **高** — 保留标题层级和阅读顺序 | ⚠️ 隐含在 Markdown 标题中，未显式建模 |
| **PDF** | surya_layout | `surya-ocr` | 仅图片——不提取文本 | ❌ 仅输出布局信息和裁剪的图片 |
| **HTML** | unstructured | `unstructured.partition_html` | 中 | ❌ 丢失 |
| **URL** | jina / firecrawl / unstructured | Jina Reader API | 高（jina 直接返回 Markdown） | ⚠️ 取决于源页面 |
| **DOCX** | pandoc / xml | pypandoc | 高（pandoc 直接输出 Markdown） | ⚠️ 隐含在 Markdown 标题中 |
| **PPTX** | unstructured | `unstructured.partition_pptx` | 中 | ❌ 丢失 |

### 核心数据流

以 EPUB 为例：

```python
# 1. unstructured 解析 EPUB → 元素列表（Title, NarrativeText, Image, ...）
elements = partition_epub(filename="book.epub")

# 2. 拼接所有文本
text = "\n".join([e.text for e in elements if e.text])

# 3. 提取图片到本地文件
images = get_epub_images("book.epub", target_image_dir="./figures")

# 4. 返回 E2MParsedData
E2MParsedData(text="Chapter 1\nIn this chapter...\nChapter 2\n...", images={...})
```

**关键发现：E2M 的 `_prepare_unstructured_data_to_e2m_parsed_data` 方法将 unstructured 的元素按顺序拼接为一个字符串，丢弃了元素的 `category` 元信息（Title/Header/Section-header 等）。** 章节层级在最终输出中完全丢失。

---

## 三、Converter 层

Converter 是 E2M 的差异化特性——用 LLM 对提取的原始文本做"格式修复"：

```python
# 输入: 从 PDF/EPUB 提取的混乱文本
# 输出: 规范 Markdown（LLM 重新组织段落、修复断行、统一标题格式）

converter = TextConverter(engine="litellm", model="deepseek/deepseek-chat", api_key="...")
markdown = converter.convert(raw_text)
```

支持两种策略：
- **`default`**：常规文本→Markdown 清洗
- **`with_toc`**：基于目录结构修复（标注为 "Not implemented yet"）

额外还有 **ImageConverter**：用视觉 LLM（如 GPT-4o）描述图片内容，生成图片的 Markdown 描述文本。

---

## 四、图片提取机制深度分析

E2M 的图片处理是它相对其他方案的亮点：

### EPUB 图片

```python
# epub_util.py: get_epub_images()
book = epub.read_epub(file_name)           # ebooklib 解析
for item in book.get_items():
    if item.media_type.startswith("image/"):
        # 保存到 image_dir/{idx}_{filename}
        # 返回 { idx: [{'image_file': path, 'image_name': name}] }
```

- 可以过滤透明背景图（`ignore_transparent_images`）：排除 UI 装饰元素
- 图片保存为本地文件，Markdown 中用相对路径引用（`![](figures/0_cover.jpg)`）
- **但**：图片插入回文本的逻辑标记为 `# todo: insert images into the epub text`——**尚未实现**

### PDF 图片

- **marker 引擎**：图片以 base64 嵌入 Markdown，然后保存为本地文件，替换 Markdown 中的 base64 引用为文件路径
- **surya_layout 引擎**：通过布局分析检测 Figure/Table 区域→裁剪→保存，同时用矩形填充原图中对应区域。标记为 "仅图片模式"——**不提取文本**，只输出图片
- **unstructured 引擎**：`extract_images_in_pdf=True` 时使用 `hi_res` 策略，提取图片并在文本中插入 `![](path)` 占位

### ImageConverter（LLM 图片描述）

这是 E2M 真正独特的地方：将提取的图片发送给视觉 LLM 生成文字描述，替代原始图片引用。

```python
# 输入: ["figures/0_diagram.png", "figures/1_chart.png"]
# 输出: "## 图1: 系统架构\n该图展示了三层架构...\n\n## 图2: 性能对比\n..."
```

对于 ReadRead 的阅读+学习场景，这个功能的价值在于：用户标记的生词/短语如果来自图片中的文字，LLM 描述可以提供上下文。但代价是每次转换都有 API 调用成本。

---

## 五、与 ReadRead 的适配性评估

### 5.1 架构层面：根本性不匹配

| 维度 | E2M | ReadRead 需求 | 匹配度 |
|------|-----|-------------|--------|
| **运行环境** | Python 后端服务 | 纯前端 React SPA | ❌ 需要架设 Python 后端 |
| **输出模型** | `E2MParsedData { text: string }` | `Document { sections: Section[] }` | ❌ 无章节结构 |
| **提取时机** | 服务端/CLI 批量处理 | 浏览器端用户上传即提取 | ❌ 用户上传一个 EPUB 等不了后台 ML 模型加载 |
| **依赖体积** | torch + surya + marker > 3GB | 浏览器端 < 2MB JS bundle | ❌ 完全不在一个量级 |
| **运行成本** | LLM Converter 每次调用消耗 tokens | 免费工具，无 API 成本 | ❌ 引入持续运营成本 |

### 5.2 E2M 适合什么场景

E2M 的设计目标明确写在 README 中：

> "E2M 项目的终极目标是为了 RAG 和模型训练/微调，提供高质量的数据"

它是为 **服务端批量数据处理 pipeline** 设计的，不是为终端用户交互式导入设计的。最适合的场景是：
- 知识库构建：批量将公司文档转为 Markdown 存入向量数据库
- 训练数据准备：将 PDF/EPUB 转为干净文本用于微调
- 内容迁移：一次性将旧格式文档库转为 Markdown

### 5.3 ReadRead 可以用 E2M 的什么

虽然不能整体集成，但以下设计思路可以借鉴：

**1. 图片提取的"过滤透明背景图"策略**
```python
# E2M 的做法
if ignore_transparent_images and has_transparent_background(image):
    continue  # 跳过 UI 装饰元素
```
ReadRead 的 EPUB 提取器可以借鉴这个启发式规则：透明背景的图片通常是出版社 logo 或 UI 装饰，不是正文内容。

**2. marker PDF 引擎的 Markdown 输出**
Marker 是当前开源 PDF→Markdown 中质量最高的方案。虽然 ReadRead 不能用 Python 直接调用，但可以考虑：
- 如果未来有服务端：用 marker 做 PDF 预处理
- 参考 marker 的标题检测逻辑（字号突变 + 字体变化 + 行距变化 的综合判断），改进前端 pdfjs-dist 的启发式标题检测

**3. 图片存储的相对路径 + 工作目录模式**
```python
work_dir = "./"
image_dir = "./figures"
# Markdown 中用相对路径: ![](figures/0_diagram.png)
```
ReadRead 的图片提取可以采用类似思路：提取图片 → 存为 base64 data URL（小图）或上传 Supabase Storage（大图）→ Markdown 中替换为最终 URL。

**4. "先提取元数据，再判定是否启用图片"的分阶段策略**
```python
extract_images: bool = True        # 是否提取图片
include_image_link_in_text: bool = True  # 是否在文本中插入 ![](path)
ignore_transparent_images: bool = False  # 是否过滤透明背景图
```
ReadRead 可以采用类似的配置分层，让用户在导入时选择"仅文本"/"文本+图片"。

---

## 六、各格式提取方案对比：E2M vs 纯前端方案

| 格式 | E2M 方案 | 纯前端替代方案 | 推荐 |
|------|---------|--------------|------|
| **EPUB** | `unstructured`(Python) → 文本拼接，无章节 | `epub2md`(npm) 或 `@denstepa/epub-parser`(npm) → 自带章节结构 | **纯前端** — epub2md 天然输出层级 sections |
| **PDF** | `marker`(Python+torch) → 高质量 Markdown | `pdfjs-dist` + 启发式标题检测，或 `pdfexcavator`(npm) → 中等质量 | **两阶段** — 第一阶段用纯前端 pdfjs-dist 做基础提取，未来可选 marker 后端做增强 |
| **HTML** | `unstructured`(Python) | `@mozilla/readability` + `turndown`（已在用） | **维持现状** — 现有方案已经够用 |
| **URL** | `jina` API | `@mozilla/readability` + CORS proxy（已在用） | **维持现状** |
| **Markdown** | 未提供专用解析器 | 手写 frontmatter + `##` 扫描 | **手写** — 逻辑简单，不需要引入依赖 |

---

## 七、关于"是否应该部署 E2M 后端"的决策分析

### 支持部署的理由

1. **PDF 提取质量**：marker 引擎的 PDF→Markdown 质量远超纯前端方案，能正确识别双栏、表格、公式
2. **格式覆盖面**：一次部署获得 EPUB/PDF/DOCX/PPTX/HTML/URL/Voice 全部格式支持
3. **LLM 清洗**：对于从扫描版 PDF 提取的混乱文本，LLM 重新排版能显著提升可读性
4. **未来扩展**：后端可以持续升级 ML 模型而不影响前端

### 反对部署的理由

1. **运维成本**：需要 GPU 服务器（marker/surya 依赖 torch），最便宜的 GPU 云实例 ~$0.5/h
2. **延迟不可接受**：用户上传一个 200 页 PDF，即使用 GPU 也需要 10-30 秒提取。用户不可能等这么久
3. **LLM 成本**：每次 Converter 调用消耗 tokens。一本 10 万词的书的清洗成本约 $0.05-0.20（用 deepseek 等廉价模型）
4. **ReadRead 的阶段定位**：目前是"构建期"个人工具，引入后端服务会大幅增加复杂度，与当前阶段不匹配
5. **章节结构仍需要前端重建**：即使后端返回了干净的 Markdown，前端的 `##`/`###` 扫描和 Section 切分逻辑仍然需要自己实现

### 结论

**不建议现在部署 E2M 后端。** 理由与设计文档中"PDF 实验性支持放 Phase 4"的逻辑一致——当前阶段的核心目标是让 EPUB 文本可读、段落可收藏，PDF 的完美提取不是瓶颈。E2M 的正确打开方式是：

> **当 ReadRead 的 EPUB 支持稳定后，如果 PDF 导入需求强烈且前端提取质量不达标，再评估是否引入 marker/marker-pdf 作为 PDF 后端服务**。那时可以只引入 PDF 相关的部分（marker），而不是整个 E2M 全家桶。

---

## 八、推荐的实施方案（更新版）

基于对 E2M 的分析，建议将设计文档中的提取器方案调整为：

### EPUB：纯前端 `epub2md` 或 `@denstepa/epub-parser`

```
epub2md.parseEpub(file)
  ├── structure → 推导 depth + parentId + order
  ├── sections → ExtractionSection[]
  └── info → { title, author }
```

- 天然输出层级结构，直接映射到 Document.sections
- 零服务端依赖，纯浏览器端运行
- 体积 < 80KB gzip

### PDF：两阶段策略

**Phase 4a（纯前端）**：`pdfjs-dist` + 启发式标题检测
- 借鉴 marker 的标题判定逻辑（字号 + 字体 + 行距 + 居中的综合判断）
- 借鉴 E2M 的 `ignore_label_types` 策略（过滤页眉/页脚/脚注）
- 标注"实验性"

**Phase 4b（可选后端增强）**：仅引入 `marker-pdf` 作为独立 PDF 转换微服务
- 只引入 PDF 相关依赖，不引入整个 E2M 体系
- 前端先尝试纯前端提取 → 质量不满足时提示用户"可上传至云端获取高质量提取"
- 这个决策至少在 Phase 3 完成后再评估

### 图片：借鉴 E2M 的分层策略

```
extract_images: true/false          # 是否提取图片
image_mode: 'placeholder' | 'base64' | 'storage'
  - placeholder: ![Figure 3-1](placeholder)  # 占位，语义保留
  - base64:     data:image/jpeg;base64,...   # 小图直接嵌入
  - storage:    https://xxx.supabase.co/...  # 大图上传存储
```

- 第一阶段默认 `placeholder`（和 E2M 的 `include_image_link_in_text=True` 精神一致）
- 借鉴 E2M 的 `ignore_transparent_images` 策略过滤装饰图
- 借鉴 E2M 的工作目录+相对路径模式管理图片文件

---

## 九、总结

| 问题 | 结论 |
|------|------|
| E2M 能否直接用于 ReadRead？ | **不能**。它是 Python 后端工具，输出模型不匹配，运行环境和延迟都不适合前端交互式导入 |
| E2M 有什么值得借鉴的？ | 图片提取的分层配置策略、marker 的标题检测逻辑、透明背景图过滤、工作目录+相对路径的图片管理模式 |
| 应该用什么替代设计文档中的手写方案？ | EPUB → `epub2md`（npm）；PDF → `pdfjs-dist` + 借鉴 marker 的启发式规则 |
| 什么时候该重新评估 E2M/ marker？ | 当 PDF 导入成为高频需求且纯前端方案质量不达标时，仅引入 marker 作为独立 PDF 后端 |
