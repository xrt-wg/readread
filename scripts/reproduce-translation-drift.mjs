#!/usr/bin/env node
/**
 * 复现实验：词/短句卡片的「词义」被语境句内容过度拟合
 *
 * 目的（对应分析报告 §5 V2/V3）：
 *  - V2：用与生产一致的 prompt，对 deepseek / kimi 各跑 N 次，
 *        统计 meaning 为「词级对应」vs「语境改写」的比例。
 *  - V3：A–E 五个 prompt 变体做消融，分离「prompt 诱导」与「模型随机」。
 *
 * 重要：kimi 已迁移到 kimi-k2.6（k2.5 已退役）；其非思考模式 temperature 固定
 * 0.6、且必须传 thinking:disabled，否则 content 恒空（结果全进 reasoning_content）。
 *
 * 用法：
 *   node scripts/reproduce-translation-drift.mjs [variant] [model] [n] [word] [context]
 *   variant: A|B|C|D|E (默认 A，即生产原样)
 *   model  : deepseek|kimi|all (默认 all)
 *   n      : 每模型次数 (默认 20)
 *   word   : 目标词/短语 (默认 neglect)
 *   context: 语境句 (默认 "And it's simply the result of neglect.")
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_DIR = join(ROOT, 'Pre-docs', 'Debug', '13_词短句词义语境过度拟合_2026-09-14', 'experiment')

const WORD = 'neglect'
const CONTEXT = "And it's simply the result of neglect."

// ── prompt 变体（A = 生产原样，与 config/translation.js bookmarkCard 逐字一致）──
const VARIANTS = {
  A: (w, c) => `You are a translation assistant.
Translate according to the context and return STRICT JSON only (no markdown, no explanation):
{"meaning":"...","contextTranslation":"..."}

Rules:
- "meaning": concise Chinese meaning of "${w}" in this context, <= 12 Chinese characters.
- "contextTranslation": Chinese translation of this sentence: "${c}".
- Keep wording natural and accurate.`,

  B: (w, c) => `You are a translation assistant.
Return STRICT JSON only (no markdown, no explanation):
{"meaning":"...","contextTranslation":"..."}

Rules:
- "meaning": concise Chinese meaning of "${w}" in this context, <= 12 Chinese characters.
- "contextTranslation": Chinese translation of this sentence: "${c}".
- Keep wording natural and accurate.`,

  C: (w, c) => `You are a translation assistant.
Translate according to the context and return STRICT JSON only (no markdown, no explanation):
{"meaning":"...","contextTranslation":"..."}

Rules:
- "meaning": concise Chinese meaning of "${w}", <= 12 Chinese characters.
- "contextTranslation": Chinese translation of this sentence: "${c}".
- Keep wording natural and accurate.`,

  D: (w, c) => `You are a translation assistant.
Translate according to the context and return STRICT JSON only (no markdown, no explanation):
{"meaning":"...","contextTranslation":"..."}

Rules:
- WORD: "${w}"
- SENTENCE: "${c}"
- "meaning": concise Chinese meaning of the WORD in this context, <= 12 Chinese characters.
- "contextTranslation": Chinese translation of the SENTENCE.
- Keep wording natural and accurate.`,

  E: (w, c) => `You are a translation assistant.
Translate according to the context and return STRICT JSON only (no markdown, no explanation):
{"meaning":"...","contextTranslation":"..."}

Rules:
- "meaning": a single short Chinese word or phrase that can directly replace "${w}" in this sentence, <= 12 Chinese characters.
- "contextTranslation": Chinese translation of this sentence: "${c}".
- Keep wording natural and accurate.`,
}

// ── 模型适配 ──
// deepseek 参数与 netlify/lib/aiProviders.cjs 对齐（temperature 0.2 + thinking disabled）。
// kimi-k2.6 非思考模式固定 temperature=0.6，且需 thinking:disabled（否则 content 恒空）。
const MODELS = {
  deepseek: {
    label: 'deepseek-v4-flash',
    url: 'https://api.deepseek.com/v1/chat/completions',
    keyEnv: 'PRESET_DEEPSEEK_API_KEY',
    concurrency: 3,
    body: (prompt) => ({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
      temperature: 0.2,
      thinking: { type: 'disabled' },
    }),
  },
  kimi: {
    label: 'kimi-k2.6 (thinking=disabled, temperature=0.6)',
    url: 'https://api.moonshot.cn/v1/chat/completions',
    keyEnv: 'PRESET_KIMI_API_KEY',
    concurrency: 1, // kimi 该 key 并发上限 1
    body: (prompt) => ({
      model: 'kimi-k2.6',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
      temperature: 0.6,
      thinking: { type: 'disabled' },
    }),
  },
}

function loadEnv() {
  const raw = readFileSync(join(ROOT, '.env'), 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

function extractMeaning(raw) {
  const str = (raw ?? '').trim()
  if (!str) return { meaning: '', raw: str, parseOk: false }
  const cleaned = str
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  try {
    const parsed = JSON.parse(cleaned)
    const meaning = String(parsed?.meaning ?? parsed?.wordMeaning ?? '').trim()
    return { meaning, raw: str, parseOk: true }
  } catch {
    return { meaning: '', raw: str, parseOk: false }
  }
}

// 漂移判定：含语境句独有关系成分（the result of 派生），或明显名词短语
function classify(meaning) {
  if (!meaning) return 'EMPTY'
  if (/结果|后果|造成|导致|所致/.test(meaning)) return 'DRIFT'
  if (meaning.length > 4 && meaning.includes('的')) return 'DRIFT'
  return 'OK'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 429 限流退避：kimi 该 key RPM=3，需按提示退避重试
async function callOnce(modelKey, prompt, env, attempt = 0) {
  const cfg = MODELS[modelKey]
  const key = env[cfg.keyEnv]
  if (!key) throw new Error(`missing ${cfg.keyEnv}`)
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(cfg.body(prompt)),
      signal: AbortSignal.timeout(20000),
    })
    if (res.status === 429 && attempt < 4) {
      await sleep(1500 * (attempt + 1))
      return callOnce(modelKey, prompt, env, attempt + 1)
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`${cfg.label} HTTP ${res.status}: ${JSON.stringify(err).slice(0, 160)}`)
    }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content ?? ''
    if (!content) throw new Error(`${cfg.label} 空响应 (finish_reason=${data.choices?.[0]?.finish_reason})`)
    return content
  } catch (e) {
    if (attempt < 1) {
      await sleep(800)
      return callOnce(modelKey, prompt, env, attempt + 1)
    }
    throw e
  }
}

async function runBatch(modelKey, prompt, n, env) {
  const cfg = MODELS[modelKey]
  const results = new Array(n)
  let cursor = 0
  const workers = Array.from({ length: cfg.concurrency }, async () => {
    while (cursor < n) {
      const idx = cursor++
      try {
        const raw = await callOnce(modelKey, prompt, env)
        const { meaning, parseOk } = extractMeaning(raw)
        results[idx] = { ok: true, meaning, parseOk, cls: classify(meaning), raw }
      } catch (e) {
        results[idx] = { ok: false, error: e.message, meaning: '', parseOk: false, cls: 'ERROR' }
      }
    }
  })
  await Promise.all(workers)
  return results
}

function summarize(label, results) {
  const counts = {}
  const meanings = new Map()
  for (const r of results) {
    counts[r.cls] = (counts[r.cls] ?? 0) + 1
    if (r.ok && r.cls !== 'ERROR') {
      meanings.set(r.meaning, (meanings.get(r.meaning) ?? 0) + 1)
    }
  }
  const drift = counts.DRIFT ?? 0
  const ok = counts.OK ?? 0
  const total = results.length
  const driftRate = total ? ((drift / total) * 100).toFixed(1) : '0.0'
  console.log(`\n=== ${label} ===`)
  console.log(`次数=${total} 词级对应(OK)=${ok} 语境改写(DRIFT)=${drift} 空=${counts.EMPTY ?? 0} 错误=${counts.ERROR ?? 0}  漂移率=${driftRate}%`)
  console.log('meaning 分布：')
  for (const [m, cnt] of [...meanings.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cnt}x  ${JSON.stringify(m)}`)
  }
  const errs = results.filter((r) => r.cls === 'ERROR')
  if (errs.length) console.log(`  错误样本：${errs.map((e) => e.error).join(' | ')}`)
  return { label, counts, driftRate, meanings: [...meanings.entries()] }
}

async function main() {
  const args = process.argv.slice(2)
  const variant = (args[0] ?? 'A').toUpperCase()
  const modelArg = args[1] ?? 'all'
  const n = parseInt(args[2] ?? '20', 10)
  const word = args[3] ?? WORD
  const context = args[4] ?? CONTEXT

  if (!VARIANTS[variant]) {
    console.error(`未知变体：${variant}（可用 ${Object.keys(VARIANTS).join('/')}）`)
    process.exit(1)
  }
  const models = modelArg === 'all' ? ['deepseek', 'kimi'] : [modelArg]
  if (models.some((m) => !MODELS[m])) {
    console.error(`未知模型：${modelArg}（可用 deepseek/kimi/all）`)
    process.exit(1)
  }

  const env = loadEnv()
  const prompt = VARIANTS[variant](word, context)
  console.log(`# 变体 ${variant} | word=${word} | context=${JSON.stringify(context)} | 每模型 ${n} 次`)
  console.log('--- prompt ---')
  console.log(prompt)
  console.log('--- 开始 ---')

  const summary = { variant, word, context, n, runAt: new Date().toISOString(), perModel: {} }
  for (const m of models) {
    const results = await runBatch(m, prompt, n, env)
    summary.perModel[m] = summarize(`${MODELS[m].label} · 变体 ${variant}`, results)
  }

  const wordSlug = word.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30)
  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `variant_${variant}_${models.join('_')}_n${n}_${wordSlug}.json`)
  writeFileSync(file, JSON.stringify(summary, null, 2), 'utf8')
  console.log(`\n结果已保存：${file}`)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
