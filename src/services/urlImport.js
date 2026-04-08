import { Readability } from '@mozilla/readability'
import { htmlToMarkdown } from '../utils/markdownUtils'

const PROXIES = [
  {
    buildUrl: (u) => `/.netlify/functions/proxy?url=${encodeURIComponent(u)}`,
    extract: async (res) => { const d = await res.json(); return d.html ?? null },
  },
  {
    buildUrl: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    extract: async (res) => { const d = await res.json(); return d.contents ?? null },
  },
  {
    buildUrl: (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    extract: async (res) => res.text(),
  },
]

async function fetchWithTimeout(url, userSignal, timeoutMs = 15000) {
  const timerCtrl = new AbortController()
  const id = setTimeout(() => timerCtrl.abort(), timeoutMs)
  if (userSignal) {
    userSignal.addEventListener('abort', () => timerCtrl.abort(), { once: true })
  }
  try {
    return await fetch(url, { signal: timerCtrl.signal })
  } finally {
    clearTimeout(id)
  }
}

function cleanTitle(raw) {
  if (!raw) return ''
  return raw.replace(/\s+[|·\-—–]\s+[^|·\-—–]+$/, '').trim()
}

function resolveImageUrls(html, baseUrl) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  doc.querySelectorAll('img[src]').forEach((img) => {
    try {
      img.setAttribute('src', new URL(img.getAttribute('src'), baseUrl).href)
    } catch {
      // 无效 URL，保持原值
    }
  })
  return doc.body.innerHTML
}

function parseArticle(html, normalized) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const base = doc.createElement('base')
  base.href = normalized
  doc.head.prepend(base)
  const article = new Readability(doc).parse()
  if (!article?.textContent?.trim()) return null
  return article
}

export async function fetchArticleFromUrl(url, signal) {
  let normalized = url.trim()
  if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized

  let lastErr = null

  for (const proxy of PROXIES) {
    try {
      const res = await fetchWithTimeout(proxy.buildUrl(normalized), signal)
      if (!res.ok) {
        lastErr = new Error(`代理服务器返回错误（HTTP ${res.status}），请稍后重试`)
        continue
      }
      const html = await proxy.extract(res)
      if (!html) { lastErr = new Error('代理未返回页面内容'); continue }

      const article = parseArticle(html, normalized)
      if (!article || !article.textContent?.trim()) {
        throw new Error('无法提取文章正文。该页面可能需要登录、有付费墙或反爬限制，请切换到「手动上传」模式')
      }
      const resolvedContent = resolveImageUrls(article.content ?? '', normalized)
      return {
        title: cleanTitle(article.title) || new URL(normalized).hostname,
        text: article.textContent.trim(),
        markdown: htmlToMarkdown(resolvedContent),
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e
      if (lastErr && e.message?.includes('无法提取')) throw e
      lastErr = e
    }
  }

  const msg = lastErr?.message ?? ''
  if (lastErr?.name === 'TypeError' || msg.toLowerCase().includes('failed to fetch')) {
    throw new Error('网络连接失败，无法访问代理服务。请检查网络连接后重试，或切换到「手动上传」模式')
  }
  throw new Error(msg || '导入失败，请切换到「手动上传」模式')
}
