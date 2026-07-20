import { useState, useEffect, useRef, useCallback } from 'react'
import { Sparkles, X, Plus, AlertCircle, Loader, RefreshCw, Edit3, Check } from 'lucide-react'
import { checkSubmissionEligibility } from '../services/supabase/recommendationService'
import { generateRecommendationContent } from '../services/aiProviders'
import recConfig from '../../config/recommendation.json'

const MAX_KEYWORDS = recConfig.constraints?.maxKeywords ?? 4

export default function SubmitRecommendationModal({
  userId, canUseCloudLibrary, importItems, preSelectedId, onClose, onSubmitted,
  generationCache, onCacheUpdate,
}) {
  const [eligibleItems, setEligibleItems] = useState([])
  const [checking, setChecking] = useState(true)
  const [selectedId, setSelectedId] = useState(preSelectedId || '')
  const [eligibilityMsg, setEligibilityMsg] = useState('')

  // 基本属性（预填自选中 item，用户可编辑）
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')

  // 策展内容（AI 填充或手动填写，共用同一套 state）
  const [intro, setIntro] = useState('')
  const [keywords, setKeywords] = useState([])
  const [keywordsTrans, setKeywordsTrans] = useState([])
  const [excerpts, setExcerpts] = useState(['', '', ''])
  const [excerptsTrans, setExcerptsTrans] = useState(['', '', ''])

  // 手动关键词输入
  const [manualKeywordEn, setManualKeywordEn] = useState('')
  const [manualKeywordZh, setManualKeywordZh] = useState('')

  // AI 生成状态
  const [generating, setGenerating] = useState(false)
  const [generationFailed, setGenerationFailed] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [hasAiGenerated, setHasAiGenerated] = useState(false)

  // 提交状态
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // 策展内容编辑模式（默认查看模式）
  const [isEditing, setIsEditing] = useState(false)

  const abortRef = useRef(null)

  // ─── 获取选中 item 的全文 ──────────────────────────────────────────────────
  const getSelectedItem = useCallback(() => {
    return eligibleItems.find(i => i.id === selectedId) || null
  }, [eligibleItems, selectedId])

  const getArticleFullText = useCallback((item) => {
    if (!item?.sections) return ''
    return item.sections
      .map(s => (s.body?.text || ''))
      .join('\n\n')
      .trim()
  }, [])

  // ─── 批量预取可提交的 item ────────────────────────────────────────────────
  useEffect(() => {
    let active = true
    async function check() {
      setChecking(true)
      const results = []
      const rejectReasons = []
      const candidates = importItems.filter(i => i.origin === 'imported')
      if (candidates.length === 0) {
        if (active) {
          setEligibleItems([])
          setChecking(false)
          setEligibilityMsg('书架中暂无自导入内容——通过 URL 导入、粘贴或上传一篇文章即可开始。')
        }
        return
      }
      for (const item of candidates) {
        try {
          const { canSubmit, reason } = await checkSubmissionEligibility(userId, item.id)
          if (canSubmit) {
            results.push(item)
          } else if (reason) {
            rejectReasons.push(reason)
          }
        } catch (e) {
          console.error('[SubmitModal] eligibility check failed for item', item.id, item.title, e)
          rejectReasons.push('系统检查异常: ' + (e.message || '未知错误'))
        }
      }
      if (active) {
        setEligibleItems(results)
        setChecking(false)
        if (results.length === 0) {
          const topReason = rejectReasons.length > 0
            ? rejectReasons.sort((a, b) =>
                rejectReasons.filter(r => r === a).length - rejectReasons.filter(r => r === b).length
              ).pop()
            : null
          const detail = topReason ? `（${topReason}）` : ''
          setEligibilityMsg(`暂无可提交的内容${detail}——导入一篇文章、读完它、就可以来推荐。`)
        }
      }
    }
    check()
    return () => { active = false }
  }, [userId, importItems])

  // ─── 预选了某 item 且它在 eligible 中，自动选中 ──────────────────────────────
  useEffect(() => {
    if (preSelectedId && eligibleItems.some(i => i.id === preSelectedId)) {
      setSelectedId(preSelectedId)
    }
  }, [preSelectedId, eligibleItems])

  // ─── 选中 item 改变 → 预填基本属性 + 检查缓存 ──────────────────────────────
  useEffect(() => {
    const item = eligibleItems.find(i => i.id === selectedId)
    if (!item) {
      // 未选中任何 item
      setTitle(''); setAuthor(''); setSourceUrl('')
      setIntro(''); setKeywords([]); setKeywordsTrans([])
      setExcerpts(['', '', '']); setExcerptsTrans(['', '', ''])
      setHasAiGenerated(false); setGenerationFailed(false); setGenerationError('')
      setIsEditing(false)
      return
    }

    // 预填基本属性
    setTitle(item.title || '')
    setAuthor(item.author || '')
    setSourceUrl(item.sourceUrl || '')

    // 检查缓存
    const cached = generationCache?.[selectedId]
    if (cached) {
      setIntro(cached.intro || '')
      setKeywords(cached.keywords || [])
      setKeywordsTrans(cached.keywordsTrans || [])
      setExcerpts(cached.excerpts || ['', '', ''])
      setExcerptsTrans(cached.excerptsTrans || ['', '', ''])
      setHasAiGenerated(true)
      setGenerationFailed(false)
      setGenerationError('')
      setIsEditing(false)
    } else {
      setIntro(''); setKeywords([]); setKeywordsTrans([])
      setExcerpts(['', '', '']); setExcerptsTrans(['', '', ''])
      setHasAiGenerated(false); setGenerationFailed(false); setGenerationError('')
      setIsEditing(false)
    }

    setSubmitError('')
  }, [selectedId, eligibleItems, generationCache])

  // ─── 组件卸载时取消进行中的 AI 请求 ────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    }
  }, [])

  // ─── AI 生成 ──────────────────────────────────────────────────────────────
  async function handleGenerate() {
    const item = getSelectedItem()
    if (!item) return

    const articleText = getArticleFullText(item)
    if (!articleText || articleText.length < 100) {
      setGenerationFailed(true)
      setGenerationError('文章内容不足，无法生成推荐内容（至少需要 100 字符）')
      return
    }

    // 取消上一次请求（若有）
    if (abortRef.current) {
      abortRef.current.abort()
    }

    const controller = new AbortController()
    abortRef.current = controller

    // 超时自动取消
    const timeoutMs = recConfig.timeout ?? 25000
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    setGenerating(true)
    setGenerationFailed(false)
    setGenerationError('')

    try {
      const result = await generateRecommendationContent({
        articleText,
        title: item.title,
        author: item.author || undefined,
        signal: controller.signal,
      })

      setIntro(result.intro || '')
      setKeywords(result.keywords || [])
      setKeywordsTrans(result.keywords_trans || [])
      setExcerpts((result.excerpts || []).concat(['', '', '']).slice(0, 3))
      setExcerptsTrans((result.excerpts_trans || []).concat(['', '', '']).slice(0, 3))
      setHasAiGenerated(true)
      setIsEditing(false)

      // 写入缓存
      if (onCacheUpdate) {
        onCacheUpdate(prev => ({
          ...prev,
          [selectedId]: {
            intro: result.intro || '',
            keywords: result.keywords || [],
            keywordsTrans: result.keywords_trans || [],
            excerpts: (result.excerpts || []).concat(['', '', '']).slice(0, 3),
            excerptsTrans: (result.excerpts_trans || []).concat(['', '', '']).slice(0, 3),
          },
        }))
      }
    } catch (e) {
      console.error('[SubmitModal] AI generation failed:', e)
      setGenerationFailed(true)
      setGenerationError(e.message || 'AI 生成失败，请手动填写')
    } finally {
      clearTimeout(timeoutId)
      setGenerating(false)
      abortRef.current = null
    }
  }

  // ─── 关键词操作 ─────────────────────────────────────────────────────────────
  function removeKeyword(index) {
    setKeywords(prev => prev.filter((_, i) => i !== index))
    setKeywordsTrans(prev => prev.filter((_, i) => i !== index))
  }

  function addManualKeyword() {
    const en = manualKeywordEn.trim()
    const zh = manualKeywordZh.trim()
    if (en && keywords.length < MAX_KEYWORDS) {
      setKeywords([...keywords, en])
      setKeywordsTrans([...keywordsTrans, zh || en])
      setManualKeywordEn('')
      setManualKeywordZh('')
    }
  }

  function handleKeywordKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addManualKeyword()
    }
  }

  // ─── 摘录操作 ───────────────────────────────────────────────────────────────
  function updateExcerpt(index, value) {
    setExcerpts(prev => { const next = [...prev]; next[index] = value; return next })
  }

  function updateExcerptTrans(index, value) {
    setExcerptsTrans(prev => { const next = [...prev]; next[index] = value; return next })
  }

  // ─── 提交 ───────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!selectedId || !title.trim() || !intro.trim() || !excerpts.some(e => e.trim())) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const { submitRecommendation } = await import('../services/supabase')
      await submitRecommendation({
        importItemId: selectedId,
        intro: intro.trim(),
        keywords,
        keywordsTrans,
        excerpts: excerpts.filter(e => e.trim()),
        excerptsTrans: excerptsTrans.filter(e => e.trim()),
        title: title.trim(),
        author: author.trim() || null,
        sourceUrl: sourceUrl.trim() || null,
      }, userId, { canUseCloudLibrary })
      onSubmitted()
    } catch (e) {
      setSubmitError(e.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── 关闭清理 ───────────────────────────────────────────────────────────────
  function handleClose() {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    onClose()
  }

  const selectedItem = getSelectedItem()
  const articleText = selectedItem ? getArticleFullText(selectedItem) : ''
  const canGenerate = selectedItem && articleText.length >= 100 && !generating
  const canSubmit = selectedId && title.trim() && intro.trim() && excerpts.some(e => e.trim()) && !submitting

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-12 px-4"
      style={{ background: 'rgba(28,25,23,0.45)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="rounded-3xl p-8 w-full animate-fade-up" style={{ maxWidth: '560px', background: '#ffffff', boxShadow: '0 8px 40px rgba(28,25,23,0.18)' }}>
        {/* header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Sparkles size={15} style={{ color: 'var(--gold)' }} />
            <span style={{ fontSize: '15px', fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink)' }}>提交推荐</span>
          </div>
          <button onClick={handleClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: '4px', borderRadius: '8px' }}>
            <X size={16} />
          </button>
        </div>

        {checking ? (
          <p style={{ fontSize: '13px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', padding: '16px 0' }}>正在检查可提交内容…</p>
        ) : eligibleItems.length === 0 ? (
          <div className="rounded-2xl px-4 py-6 text-center" style={{ background: 'var(--parchment-50)' }}>
            <AlertCircle size={24} style={{ opacity: 0.3, color: 'var(--ink-muted)', marginBottom: '10px' }} />
            <p style={{ fontSize: '13px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', lineHeight: 1.6 }}>{eligibilityMsg}</p>
          </div>
        ) : (
          <>
            {/* ═══ 选择素材 ═══ */}
            <label style={labelStyle}>选择书架内容</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              style={selectStyle}>
              <option value="">请选择…</option>
              {eligibleItems.map(item => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>

            {selectedItem && (
              <>
                {/* ═══ 基本属性 ═══ */}
                <div className="rounded-2xl px-4 py-4 mb-4" style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.07)' }}>
                  <p style={{ fontSize: '11px', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: '12px' }}>基本属性（确认或修改）</p>
                  <div className="flex flex-col gap-3">
                    <div>
                      <label style={fieldLabelStyle}>标题</label>
                      <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                        style={inputStyle} />
                    </div>
                    <div>
                      <label style={fieldLabelStyle}>作者</label>
                      <input type="text" value={author} onChange={e => setAuthor(e.target.value)} placeholder="（可选）"
                        style={inputStyle} />
                    </div>
                    <div>
                      <label style={fieldLabelStyle}>来源 URL</label>
                      <input type="text" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://..."
                        style={inputStyle} />
                    </div>
                  </div>
                </div>

                {/* ═══ AI 策展内容 ═══ */}
                <div className="rounded-2xl px-4 py-4 mb-4" style={{ background: 'var(--parchment-50)', border: '1px solid rgba(28,25,23,0.07)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <p style={{ fontSize: '11px', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink-muted)' }}>策展内容</p>
                    {(hasAiGenerated || generationFailed) && intro && (
                      <button onClick={() => setIsEditing(!isEditing)}
                        className="flex items-center gap-1 rounded-lg px-3 py-1.5 transition-all"
                        style={{
                          background: 'transparent',
                          border: '1px solid rgba(28,25,23,0.12)',
                          cursor: 'pointer',
                          fontSize: '11px', fontFamily: 'DM Sans', fontWeight: 500,
                          color: 'var(--ink-muted)',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(28,25,23,0.05)'; e.currentTarget.style.color = 'var(--ink)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}>
                        {isEditing ? (
                          <><Check size={12} />完成编辑</>
                        ) : (
                          <><Edit3 size={12} />编辑</>
                        )}
                      </button>
                    )}
                  </div>

                  {/* 生成按钮 */}
                  {!hasAiGenerated && !generating && (
                    <div className="text-center py-6">
                      <button onClick={handleGenerate} disabled={!canGenerate}
                        className="flex items-center gap-2 mx-auto rounded-xl px-5 py-3 transition-all"
                        style={{
                          background: canGenerate ? 'var(--gold)' : 'rgba(28,25,23,0.08)',
                          color: canGenerate ? '#fff' : 'rgba(28,25,23,0.3)',
                          border: 'none', cursor: canGenerate ? 'pointer' : 'default',
                          fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500,
                        }}
                        onMouseEnter={(e) => { if (canGenerate) e.currentTarget.style.background = '#b8933e' }}
                        onMouseLeave={(e) => { if (canGenerate) e.currentTarget.style.background = 'var(--gold)' }}>
                        <Sparkles size={14} />
                        生成推荐内容
                      </button>
                      {!canGenerate && selectedItem && (
                        <p style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', marginTop: '6px' }}>文章内容不足，无法生成（至少需要 100 字符）</p>
                      )}
                    </div>
                  )}

                  {/* 生成中 */}
                  {generating && (
                    <div className="flex items-center justify-center gap-2 py-8">
                      <Loader size={14} className="animate-spin" style={{ color: 'var(--gold)' }} />
                      <span style={{ fontSize: '13px', fontFamily: 'DM Sans', color: 'var(--ink-muted)' }}>AI 正在分析文章并生成推荐内容…</span>
                    </div>
                  )}

                  {/* 生成失败 */}
                  {generationFailed && !generating && (
                    <div className="rounded-xl px-3 py-2 mb-3" style={{ background: 'rgba(254,242,242,0.88)', border: '1px solid rgba(239,68,68,0.14)' }}>
                      <p style={{ fontSize: '11px', fontFamily: 'DM Sans', color: '#b91c1c', marginBottom: '2px' }}>
                        ⚠ 生成失败：{generationError}
                      </p>
                      <p style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)' }}>
                        你可以手动填写下方内容，或
                        <button onClick={handleGenerate} disabled={!canGenerate}
                          style={{ background: 'transparent', border: 'none', cursor: canGenerate ? 'pointer' : 'default', fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--gold-dark)', fontWeight: 500, textDecoration: 'underline', padding: 0 }}>重试</button>
                      </p>
                    </div>
                  )}

                  {/* ═══ 查看模式（默认） ═══ */}
                  {(hasAiGenerated || generationFailed) && !isEditing && intro && (
                    <div className="flex flex-col gap-4">
                      {/* 介绍 */}
                      <div>
                        <p style={{ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)', marginBottom: '6px', opacity: 0.7 }}>介绍</p>
                        <p style={{
                          fontFamily: 'DM Sans', fontSize: '13px',
                          color: 'var(--ink-light)', lineHeight: 1.75,
                          paddingLeft: '12px',
                          borderLeft: '2.5px solid rgba(196,154,60,0.28)',
                        }}>{intro}</p>
                      </div>

                      {/* 关键词 */}
                      {keywords.length > 0 && (
                        <div>
                          <p style={{ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)', marginBottom: '6px', opacity: 0.7 }}>关键词</p>
                          <div className="flex flex-wrap gap-2">
                            {keywords.map((kw, i) => (
                              <span key={i} className="inline-flex items-center rounded-md overflow-hidden"
                                style={{ background: '#ffffff', border: '1px solid rgba(28,25,23,0.08)', fontSize: '12px' }}>
                                <span style={{ fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink)', padding: '3px 8px' }}>{kw}</span>
                                <span style={{ fontFamily: 'DM Sans', color: 'var(--ink-muted)', padding: '3px 8px', background: 'rgba(28,25,23,0.03)', borderLeft: '1px solid rgba(28,25,23,0.08)' }}>{keywordsTrans[i] || kw}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 摘录 */}
                      {excerpts.some(e => e.trim()) && (
                        <div>
                          <p style={{ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)', marginBottom: '8px', opacity: 0.7 }}>摘录</p>
                          <div className="flex flex-col gap-3">
                            {excerpts.filter(e => e.trim()).map((ex, i) => (
                              <div key={i} className="rounded-xl px-4 py-3" style={{ background: '#ffffff', border: '1px solid rgba(28,25,23,0.06)' }}>
                                <span style={{ fontSize: '10px', letterSpacing: '0.04em', fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--gold-dark)', opacity: 0.6, marginBottom: '6px', display: 'block' }}>摘录 {i + 1}</span>
                                <p style={{ fontFamily: '"Lora", Georgia, serif', fontSize: '14px', fontStyle: 'italic', lineHeight: 1.75, color: 'var(--ink)', marginBottom: '8px' }}>{ex}</p>
                                <div style={{ height: '1px', background: 'rgba(28,25,23,0.06)', marginBottom: '8px' }} />
                                <p style={{ fontFamily: 'DM Sans', fontSize: '12px', lineHeight: 1.65, color: 'var(--ink-muted)' }}>{excerptsTrans[i] || ''}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 底部操作 */}
                      <div className="flex items-center justify-between pt-1">
                        <button onClick={handleGenerate} disabled={!canGenerate}
                          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all"
                          style={{
                            background: 'transparent', border: 'none', cursor: canGenerate ? 'pointer' : 'default',
                            fontSize: '11px', fontFamily: 'DM Sans', fontWeight: 500,
                            color: canGenerate ? 'var(--ink-muted)' : 'rgba(28,25,23,0.2)',
                          }}
                          onMouseEnter={(e) => { if (canGenerate) { e.currentTarget.style.color = 'var(--gold-dark)'; e.currentTarget.style.background = 'rgba(196,154,60,0.05)' } }}
                          onMouseLeave={(e) => { if (canGenerate) { e.currentTarget.style.color = 'var(--ink-muted)'; e.currentTarget.style.background = 'transparent' } }}>
                          <RefreshCw size={11} />重新生成
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ═══ 编辑模式 ═══ */}
                  {(hasAiGenerated || generationFailed) && isEditing && (
                    <div className="flex flex-col gap-4">
                      {/* 介绍 */}
                      <div>
                        <label style={{ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)', marginBottom: '4px', display: 'block', opacity: 0.7 }}>介绍</label>
                        <textarea value={intro} onChange={e => setIntro(e.target.value)}
                          placeholder="为什么推荐这篇文章？它好在哪里？"
                          rows={3}
                          style={{
                            width: '100%', padding: '10px 12px', borderRadius: '10px',
                            border: '1px solid rgba(28,25,23,0.12)', fontSize: '13px', fontFamily: 'DM Sans',
                            background: '#ffffff', color: 'var(--ink)', resize: 'vertical', lineHeight: 1.7,
                          }} />
                      </div>

                      {/* 关键词 */}
                      <div>
                        <label style={{ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)', marginBottom: '4px', display: 'block', opacity: 0.7 }}>
                          关键词（{keywords.length}/{MAX_KEYWORDS}，中英配对）
                        </label>
                        {keywords.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {keywords.map((kw, i) => (
                              <span key={i} className="inline-flex items-center rounded-md overflow-hidden"
                                style={{ background: '#ffffff', border: '1px solid rgba(196,154,60,0.18)', fontSize: '12px' }}>
                                <span style={{ fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink)', padding: '3px 8px' }}>{kw}</span>
                                <span style={{ fontFamily: 'DM Sans', color: 'var(--ink-muted)', padding: '3px 6px', background: 'rgba(28,25,23,0.02)', borderLeft: '1px solid rgba(196,154,60,0.12)', fontSize: '11px' }}>{keywordsTrans[i] || ''}</span>
                                <button onClick={() => removeKeyword(i)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: '0 6px', lineHeight: 1 }}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626' }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-muted)' }}>
                                  <X size={11} />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {keywords.length < MAX_KEYWORDS && (
                          <div className="flex items-center gap-2">
                            <input value={manualKeywordEn} onChange={e => setManualKeywordEn(e.target.value)} onKeyDown={handleKeywordKeyDown}
                              placeholder="英文"
                              style={{ width: '120px', padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(28,25,23,0.12)', fontSize: '11px', fontFamily: 'DM Sans', background: '#ffffff', color: 'var(--ink)' }} />
                            <input value={manualKeywordZh} onChange={e => setManualKeywordZh(e.target.value)} onKeyDown={handleKeywordKeyDown}
                              placeholder="中文翻译"
                              style={{ flex: 1, padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(28,25,23,0.12)', fontSize: '11px', fontFamily: 'DM Sans', background: '#ffffff', color: 'var(--ink)' }} />
                            <button onClick={addManualKeyword} disabled={!manualKeywordEn.trim()}
                              style={{ padding: '5px 10px', borderRadius: '8px', border: 'none', cursor: manualKeywordEn.trim() ? 'pointer' : 'default', background: 'var(--ink)', color: 'var(--on-ink)', fontSize: '11px', fontFamily: 'DM Sans', opacity: manualKeywordEn.trim() ? 1 : 0.4 }}>
                              <Plus size={12} />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* 摘录 */}
                      <div>
                        <label style={{ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)', marginBottom: '6px', display: 'block', opacity: 0.7 }}>摘录（3 条）</label>
                        <div className="flex flex-col gap-3">
                          {excerpts.map((ex, i) => (
                            <div key={i} className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid rgba(28,25,23,0.08)' }}>
                              <div className="flex items-center justify-between px-3 py-1.5" style={{ background: 'rgba(28,25,23,0.02)', borderBottom: '1px solid rgba(28,25,23,0.05)' }}>
                                <span style={{ fontSize: '10px', letterSpacing: '0.04em', fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink-muted)' }}>摘录 {i + 1}</span>
                                <span style={{ fontSize: '9px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.5 }}>原文</span>
                              </div>
                              <textarea value={ex} onChange={e => updateExcerpt(i, e.target.value)}
                                placeholder="从原文中选取的代表性段落…"
                                rows={2}
                                style={{
                                  width: '100%', padding: '8px 12px', border: 'none', borderBottom: '1px solid rgba(28,25,23,0.05)',
                                  fontSize: '13px', fontFamily: '"Lora", Georgia, serif', fontStyle: 'italic',
                                  background: '#ffffff', color: 'var(--ink)', resize: 'vertical', lineHeight: 1.75,
                                }} />
                              <div className="px-3 py-1" style={{ background: 'rgba(28,25,23,0.01)' }}>
                                <span style={{ fontSize: '9px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.5 }}>中文翻译</span>
                              </div>
                              <textarea value={excerptsTrans[i] || ''} onChange={e => updateExcerptTrans(i, e.target.value)}
                                placeholder="对应中文翻译…"
                                rows={2}
                                style={{
                                  width: '100%', padding: '8px 12px', border: 'none',
                                  fontSize: '12px', fontFamily: 'DM Sans',
                                  background: '#ffffff', color: 'var(--ink)', resize: 'vertical', lineHeight: 1.65,
                                }} />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 重新生成 */}
                      <div className="flex justify-start">
                        <button onClick={handleGenerate} disabled={!canGenerate}
                          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all"
                          style={{
                            background: 'transparent', border: 'none', cursor: canGenerate ? 'pointer' : 'default',
                            fontSize: '11px', fontFamily: 'DM Sans', fontWeight: 500,
                            color: canGenerate ? 'var(--ink-muted)' : 'rgba(28,25,23,0.2)',
                          }}
                          onMouseEnter={(e) => { if (canGenerate) { e.currentTarget.style.color = 'var(--gold-dark)'; e.currentTarget.style.background = 'rgba(196,154,60,0.05)'; e.currentTarget.style.borderRadius = '6px' } }}
                          onMouseLeave={(e) => { if (canGenerate) { e.currentTarget.style.color = 'var(--ink-muted)'; e.currentTarget.style.background = 'transparent' } }}>
                          <RefreshCw size={11} />重新生成
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ═══ 提交错误 ═══ */}
            {submitError && (
              <p style={{ fontSize: '11px', fontFamily: 'DM Sans', color: '#dc2626', marginBottom: '12px' }}>{submitError}</p>
            )}

            {/* ═══ actions ═══ */}
            <div className="flex items-center justify-end gap-3" style={{ borderTop: '1px solid rgba(28,25,23,0.06)', paddingTop: '16px' }}>
              <button onClick={handleClose}
                style={{ padding: '9px 18px', borderRadius: '10px', border: '1px solid rgba(28,25,23,0.12)', background: 'transparent', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)' }}>
                取消
              </button>
              <button onClick={handleSubmit} disabled={!canSubmit}
                style={{ padding: '9px 18px', borderRadius: '10px', border: 'none', cursor: canSubmit ? 'pointer' : 'default', background: 'var(--ink)', color: 'var(--on-ink)', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, opacity: canSubmit ? 1 : 0.4 }}>
                {submitting ? '提交中…' : '提交推荐'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── 内联样式常量 ───────────────────────────────────────────────────────────

const labelStyle = {
  fontSize: '12px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink)',
  marginBottom: '6px', display: 'block',
}

const selectStyle = {
  width: '100%', padding: '10px 12px', borderRadius: '12px',
  border: '1px solid rgba(28,25,23,0.12)', fontSize: '13px', fontFamily: 'DM Sans',
  background: 'var(--parchment-50)', color: 'var(--ink)', marginBottom: '16px',
}

const fieldLabelStyle = {
  fontSize: '11px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)',
  marginBottom: '4px', display: 'block',
}

const inputStyle = {
  width: '100%', padding: '8px 12px', borderRadius: '10px',
  border: '1px solid rgba(28,25,23,0.12)', fontSize: '13px', fontFamily: 'DM Sans',
  background: '#ffffff', color: 'var(--ink)',
}

