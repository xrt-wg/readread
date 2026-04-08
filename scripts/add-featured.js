#!/usr/bin/env node
/**
 * 推荐阅读配置脚本
 *
 * 用法：
 *   node scripts/add-featured.js --url <URL>
 *   node scripts/add-featured.js --file <path>
 *
 * 可选覆盖参数：
 *   --title  "自定义标题"
 *   --source "来源媒体"
 *   --desc   "一句话简介"
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, extname, basename } from 'path'
import { fileURLToPath } from 'url'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const FEATURED_PATH = resolve(__dirname, '../src/data/featuredArticles.js')

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : null
}

const urlArg    = getArg('--url')
const fileArg   = getArg('--file')
const titleOver = getArg('--title')
const sourceOver = getArg('--source')
const descOver  = getArg('--desc')

if (!urlArg && !fileArg) {
  console.error([
    '用法：',
    '  node scripts/add-featured.js --url <URL>',
    '  node scripts/add-featured.js --file <path>',
    '',
    '可选：',
    '  --title  "自定义标题"',
    '  --source "来源媒体"',
    '  --desc   "一句话简介"',
  ].join('\n'))
  process.exit(1)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })

function htmlToMarkdown(html) {
  return td.turndown(html)
}

function cleanTitle(raw) {
  if (!raw) return ''
  return raw.replace(/\s+[|·\-—–]\s+[^|·\-—–]+$/, '').trim()
}

function resolveImages(html, baseUrl) {
  const dom = new JSDOM(html, { url: baseUrl })
  dom.window.document.querySelectorAll('img[src]').forEach((img) => {
    try {
      img.setAttribute('src', new URL(img.getAttribute('src'), baseUrl).href)
    } catch { /* invalid URL, keep original */ }
  })
  return dom.window.document.body.innerHTML
}

// ─── Sources ─────────────────────────────────────────────────────────────────

async function fromUrl(url) {
  let normalized = url.trim()
  if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized

  console.log(`正在抓取：${normalized}`)
  const res = await fetch(normalized, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReadRead-Script/1.0)' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()

  const dom = new JSDOM(html, { url: normalized })
  const article = new Readability(dom.window.document).parse()
  if (!article?.textContent?.trim()) throw new Error('无法提取正文，该页面可能需要登录或有付费墙')

  const resolvedContent = resolveImages(article.content ?? '', normalized)
  return {
    title:       titleOver  || cleanTitle(article.title) || new URL(normalized).hostname,
    source:      sourceOver || new URL(normalized).hostname,
    description: descOver   || '',
    text:        article.textContent.trim(),
    markdown:    htmlToMarkdown(resolvedContent),
  }
}

async function fromFile(filePath) {
  const abs = resolve(filePath)
  const ext = extname(abs).toLowerCase()
  const name = basename(abs, ext)
  const content = readFileSync(abs, 'utf-8')

  if (ext === '.html' || ext === '.htm') {
    const dom = new JSDOM(content, { url: `file://${abs}` })
    const article = new Readability(dom.window.document).parse()
    if (!article?.textContent?.trim()) throw new Error('无法从 HTML 文件提取正文')
    return {
      title:       titleOver  || cleanTitle(article.title) || name,
      source:      sourceOver || '',
      description: descOver   || '',
      text:        article.textContent.trim(),
      markdown:    htmlToMarkdown(article.content ?? ''),
    }
  }

  // .md / .markdown — strip frontmatter
  let body = content
  let fmTitle = ''
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (fmMatch) {
    body = content.slice(fmMatch[0].length)
    const m = fmMatch[1].match(/^(?:title|name)\s*:\s*(.+)$/m)
    if (m) fmTitle = m[1].trim()
  }
  return {
    title:       titleOver  || fmTitle || name,
    source:      sourceOver || '',
    description: descOver   || '',
    text:        body,
    markdown:    body,
  }
}

// ─── Write to featuredArticles.js ────────────────────────────────────────────

function appendToFeatured(entry) {
  const src = readFileSync(FEATURED_PATH, 'utf-8')

  const ids = [...src.matchAll(/id:\s*'featured_(\d+)'/g)].map((m) => parseInt(m[1]))
  const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1

  const mdValue = entry.markdown
    ? `\`${String.raw`${entry.markdown}`}\``
    : 'null'

  const block = [
    '  {',
    `    id: 'featured_${nextId}',`,
    `    title: ${JSON.stringify(entry.title)},`,
    `    source: ${JSON.stringify(entry.source)},`,
    `    description: ${JSON.stringify(entry.description)},`,
    `    text: ${JSON.stringify(entry.text)},`,
    `    markdown: ${entry.markdown ? JSON.stringify(entry.markdown) : 'null'},`,
    '  },',
  ].join('\n')

  const updated = src.replace(/(\n\][\s\n]*)$/, `\n${block}\n]`)
  writeFileSync(FEATURED_PATH, updated, 'utf-8')

  console.log(`✓ 已添加 featured_${nextId}：${entry.title}`)
  if (entry.description) console.log(`  简介：${entry.description}`)
  console.log(`  来源：${entry.source || '（未指定）'}`)
  console.log(`  字数：${entry.text.split(/\s+/).filter(Boolean).length}`)
}

// ─── Main ────────────────────────────────────────────────────────────────────

try {
  const entry = urlArg ? await fromUrl(urlArg) : await fromFile(fileArg)
  appendToFeatured(entry)
} catch (e) {
  console.error('失败：', e.message)
  process.exit(1)
}
