import { htmlToMarkdown } from '../utils/markdownUtils'
import { getReadability } from '../utils/readability'
import { getSession } from './supabase/auth'

const PROXIES = [
  {
    buildUrl: (u) => `/.netlify/functions/proxy?url=${encodeURIComponent(u)}`,
    // 服务端 proxy 已加 JWT 鉴权：仅本 Netlify 代理需注入 access_token，外部代理无需
    headers: async () => {
      try {
        const session = await getSession()
        return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
      } catch {
        return {}
      }
    },
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

async function fetchWithTimeout(url, userSignal, headers, timeoutMs = 15000) {
  const timerCtrl = new AbortController()
  let timedOut = false
  const id = setTimeout(() => { timedOut = true; timerCtrl.abort() }, timeoutMs)
  if (userSignal) {
    userSignal.addEventListener('abort', () => timerCtrl.abort(), { once: true })
  }
  try {
    return await fetch(url, { signal: timerCtrl.signal, headers })
  } catch (e) {
    // 超时与「用户主动取消」区分开：超时给友好提示，取消则原样上抛（由调用方静默处理）
    if (timedOut) throw new Error('抓取超时，请稍后重试或更换链接')
    throw e
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

async function parseArticle(html, normalized) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const base = doc.createElement('base')
  base.href = normalized
  doc.head.prepend(base)
  const Readability = await getReadability()
  const article = new Readability(doc).parse()
  if (!article?.textContent?.trim()) return null
  return article
}

export async function fetchArticleFromUrl(url, signal) {
  let normalized = url.trim()
  if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized

  // 客户端预校验：明显无效的输入（如 "bsfg"、带空格、非 http(s)）不进代理链，
  // 避免拖到代理超时才报出难懂的 "signal is aborted without reason"
  let parsedUrl
  try {
    parsedUrl = new URL(normalized)
  } catch {
    throw new Error('链接格式不正确，请检查后重试')
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('请粘贴以 http:// 或 https:// 开头的文章链接')
  }
  // 主机名须含点（或为 localhost / IP）——粗略排除单段词；内网/本机地址交服务端 SSRF 拦截
  const host = parsedUrl.hostname
  if (!host || (!host.includes('.') && host !== 'localhost')) {
    throw new Error('链接格式不正确，请检查后重试')
  }

  let lastErr = null

  for (const proxy of PROXIES) {
    try {
      const headers = proxy.headers ? await proxy.headers() : undefined
      const res = await fetchWithTimeout(proxy.buildUrl(normalized), signal, headers)
      if (!res.ok) {
        // 首个代理（Netlify）的明确拒绝不再兜底：403=内网、400=非法、502=域名解析不了，直接给友好提示
        if (proxy === PROXIES[0]) {
          if (res.status === 403) {
            lastErr = new Error('不支持导入内网或本地地址，请粘贴公开的文章链接')
            break
          }
          if (res.status === 400) {
            lastErr = new Error('链接格式不正确，请检查后重试')
            break
          }
          if (res.status === 502) {
            let errBody = ''
            try { errBody = (await res.json())?.error ?? '' } catch {}
            if (/cannot resolve host|dns resolve failed/i.test(errBody)) {
              lastErr = new Error('无法访问该链接，请确认地址是否正确')
              break
            }
            // upstream 错误：目标站拒绝/不可达，交给兜底代理再试
          }
        }
        // 其余非 2xx（兜底代理或 upstream）：不向用户泄漏原始 HTTP 状态码，用友好占位继续试下一个代理
        lastErr = new Error('无法访问该链接，请确认地址是否正确或稍后重试')
        continue
      }
      const html = await proxy.extract(res)
      if (!html) { lastErr = new Error('代理未返回页面内容'); continue }

      const article = await parseArticle(html, normalized)
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
