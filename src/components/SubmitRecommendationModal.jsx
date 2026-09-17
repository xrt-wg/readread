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

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !submitting) handleClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [submitting])

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
      const excerptIndexes = excerpts.reduce((indexes, excerpt, index) => (
        excerpt.trim() ? [...indexes, index] : indexes
      ), [])
      await submitRecommendation({
        importItemId: selectedId,
        intro: intro.trim(),
        keywords,
        keywordsTrans,
        excerpts: excerptIndexes.map(index => excerpts[index].trim()),
        excerptsTrans: excerptIndexes.map(index => excerptsTrans[index].trim()),
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
    if (submitting) return
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    onClose()
  }

  const selectedItem = getSelectedItem()
  const articleText = selectedItem ? getArticleFullText(selectedItem) : ''
  const canGenerate = selectedItem && articleText.length >= 100 && !generating
  const hasRequiredContent = title.trim() && intro.trim() && excerpts.some(e => e.trim())
  const canSubmit = selectedId && hasRequiredContent && !submitting

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(0,0,0,0.38)', backdropFilter: 'blur(3px)', overscrollBehavior: 'contain' }}
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) handleClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="submit-recommendation-title" className="rounded-3xl p-6 sm:p-8 w-full animate-fade-up" style={{ maxWidth: '680px', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', overscrollBehavior: 'contain', scrollbarGutter: 'stable', background: 'var(--popup-bg)', boxShadow: 'var(--popup-shadow)' }}>
        {/* header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Sparkles size={15} style={{ color: 'var(--gold)' }} />
            <div>
              <h2 id="submit-recommendation-title" style={{ fontSize: '16px', fontFamily: 'DM Sans', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2 }}>分享你的推荐</h2>
              <p style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', marginTop: '3px' }}>将读完的好文章推荐给更多读者</p>
            </div>
          </div>
          <button onClick={handleClose} disabled={submitting} aria-label="关闭分享推荐窗口"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: '4px', borderRadius: '8px' }}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {checking ? (
          <p aria-live="polite" style={{ fontSize: '13px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', padding: '16px 0' }}>正在检查可提交内容…</p>
        ) : eligibleItems.length === 0 ? (
          <div className="rounded-2xl px-4 py-6 text-center" style={{ background: 'var(--parchment-50)' }}>
            <AlertCircle size={24} style={{ opacity: 0.3, color: 'var(--ink-muted)', marginBottom: '10px' }} />
            <p style={{ fontSize: '13px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', lineHeight: 1.6 }}>{eligibilityMsg}</p>
          </div>
        ) : (
          <>
            {/* ═══ 选择素材 ═══ */}
            <label htmlFor="recommendation-item" style={labelStyle}>选择要分享的文章</label>
            <select id="recommendation-item" name="recommendation-item" value={selectedId} onChange={e => setSelectedId(e.target.value)}
              style={selectStyle}>
              <option value="">请选择…</option>
              {eligibleItems.map(item => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>

            {selectedItem && (
              <>
                {/* ═══ 基本属性 ═══ */}
                <div className="rounded-2xl px-4 py-4 mb-4" style={{ background: 'var(--parchment-50)', border: '1px solid var(--border-subtle)' }}>
                  <p style={{ fontSize: '11px', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: '12px' }}>基本属性（确认或修改）</p>
                  <div className="flex flex-col gap-3">
                    <div>
                       <label htmlFor="recommendation-title" style={fieldLabelStyle}>标题</label>
                       <input id="recommendation-title" name="recommendation-title" type="text" autoComplete="off" value={title} onChange={e => setTitle(e.target.value)}
                         style={inputStyle} />
                    </div>
                    <div>
                       <label htmlFor="recommendation-author" style={fieldLabelStyle}>作者</label>
                       <input id="recommendation-author" name="recommendation-author" type="text" autoComplete="off" value={author} onChange={e => setAuthor(e.target.value)} placeholder="例如：作者姓名（可选）"
                         style={inputStyle} />
                    </div>
                    <div>
                       <label htmlFor="recommendation-source-url" style={fieldLabelStyle}>来源链接</label>
                       <input id="recommendation-source-url" name="recommendation-source-url" type="url" autoComplete="off" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="例如：https://example.com/article"
                         style={inputStyle} />
                    </div>
                  </div>
                </div>

                {/* ═══ AI 策展内容 ═══ */}
                <div className="rounded-2xl px-4 py-4 mb-4" style={{ background: 'var(--parchment-50)', border: '1px solid var(--border-subtle)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <p style={{ fontSize: '11px', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink-muted)' }}>策展内容</p>
                    <button onClick={() => setIsEditing(!isEditing)}
                      className="flex items-center gap-1 rounded-lg px-3 py-1.5 transition-all"
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--surface-border)',
                        cursor: 'pointer',
                        fontSize: '11px', fontFamily: 'DM Sans', fontWeight: 500,
                        color: 'var(--ink-muted)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; e.currentTarget.style.color = 'var(--ink)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-muted)' }}>
                      {isEditing ? <><Check size={12} aria-hidden="true" />完成编辑</> : <><Edit3 size={12} aria-hidden="true" />手动填写</>}
                    </button>
                  </div>

                  {/* 生成按钮 */}
                  {!hasAiGenerated && !generating && (
                    <div className="text-center py-6">
                      <button onClick={handleGenerate} disabled={!canGenerate}
                        className="flex items-center gap-2 mx-auto rounded-xl px-5 py-3 transition-all"
                        style={{
                          background: canGenerate ? 'var(--gold)' : 'var(--hover-bg)',
                          color: canGenerate ? 'var(--on-gold)' : 'var(--ink-disabled)',
                          border: 'none', cursor: canGenerate ? 'pointer' : 'default',
                          fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500,
                        }}
                        onMouseEnter={(e) => { if (canGenerate) e.currentTarget.style.background = 'var(--gold-dark)' }}
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
                    <div aria-live="polite" className="flex items-center justify-center gap-2 py-8">
                      <Loader size={14} className="animate-spin" style={{ color: 'var(--gold)' }} />
                      <span style={{ fontSize: '13px', fontFamily: 'DM Sans', color: 'var(--ink-muted)' }}>AI 正在分析文章并生成推荐内容…</span>
                    </div>
                  )}

                  {/* 生成失败 */}
                  {generationFailed && !generating && (
                    <div className="rounded-xl px-3 py-2 mb-3" style={{ background: 'var(--danger-bg)', border: '1px solid rgba(239,68,68,0.14)' }}>
                      <p style={{ fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--danger-text)', marginBottom: '2px' }}>
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
                                style={{ background: 'var(--card-bg-warm)', border: '1px solid var(--popup-border)', fontSize: '12px' }}>
                                <span style={{ fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink)', padding: '3px 8px' }}>{kw}</span>
                                <span style={{ fontFamily: 'DM Sans', color: 'var(--ink-muted)', padding: '3px 8px', background: 'var(--hover-bg)', borderLeft: '1px solid var(--popup-border)' }}>{keywordsTrans[i] || kw}</span>
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
                              <div key={i} className="rounded-xl px-4 py-3" style={{ background: 'var(--card-bg-warm)', border: '1px solid var(--popup-border)' }}>
                                <span style={{ fontSize: '10px', letterSpacing: '0.04em', fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--gold-dark)', opacity: 0.6, marginBottom: '6px', display: 'block' }}>摘录 {i + 1}</span>
                                <p style={{ fontFamily: '"Lora", Georgia, serif', fontSize: '14px', fontStyle: 'italic', lineHeight: 1.75, color: 'var(--ink)', marginBottom: '8px' }}>{ex}</p>
                                <div style={{ height: '1px', background: 'var(--popup-divider)', marginBottom: '8px' }} />
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
                            color: canGenerate ? 'var(--ink-muted)' : 'var(--ink-disabled)',
                          }}
                          onMouseEnter={(e) => { if (canGenerate) { e.currentTarget.style.color = 'var(--gold-dark)'; e.currentTarget.style.background = 'rgba(196,154,60,0.05)' } }}
                          onMouseLeave={(e) => { if (canGenerate) { e.currentTarget.style.color = 'var(--ink-muted)'; e.currentTarget.style.background = 'transparent' } }}>
                          <RefreshCw size={11} />重新生成
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ═══ 编辑模式 ═══ */}
                  {isEditing && (
                    <div className="flex flex-col gap-4">
                      {/* 介绍 */}
                      <div>
                        <label htmlFor="recommendation-intro" style={{ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)', marginBottom: '4px', display: 'block', opacity: 0.7 }}>推荐语 <span style={{ color: 'var(--danger-text)' }}>*</span></label>
                        <textarea id="recommendation-intro" name="recommendation-intro" value={intro} onChange={e => setIntro(e.target.value)}
                          placeholder="为什么推荐这篇文章？它好在哪里？"
                          rows={3}
                          style={{
                            width: '100%', padding: '10px 12px', borderRadius: '10px',
                            border: '1px solid var(--surface-border)', fontSize: '13px', fontFamily: 'DM Sans',
                            background: 'var(--card-bg-warm)', color: 'var(--ink)', resize: 'vertical', lineHeight: 1.7,
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
                                style={{ background: 'var(--card-bg-warm)', border: '1px solid rgba(196,154,60,0.18)', fontSize: '12px' }}>
                                <span style={{ fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink)', padding: '3px 8px' }}>{kw}</span>
                                <span style={{ fontFamily: 'DM Sans', color: 'var(--ink-muted)', padding: '3px 6px', background: 'var(--hover-bg)', borderLeft: '1px solid rgba(196,154,60,0.12)', fontSize: '11px' }}>{keywordsTrans[i] || ''}</span>
                                <button onClick={() => removeKeyword(i)}
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: '0 6px', lineHeight: 1 }}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger-text)' }}
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
                              style={{ width: '120px', padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--surface-border)', fontSize: '11px', fontFamily: 'DM Sans', background: 'var(--card-bg-warm)', color: 'var(--ink)' }} />
                            <input value={manualKeywordZh} onChange={e => setManualKeywordZh(e.target.value)} onKeyDown={handleKeywordKeyDown}
                              placeholder="中文翻译"
                              style={{ flex: 1, padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--surface-border)', fontSize: '11px', fontFamily: 'DM Sans', background: 'var(--card-bg-warm)', color: 'var(--ink)' }} />
                            <button onClick={addManualKeyword} disabled={!manualKeywordEn.trim()}
                              style={{ padding: '5px 10px', borderRadius: '8px', border: 'none', cursor: manualKeywordEn.trim() ? 'pointer' : 'default', background: 'var(--ink)', color: 'var(--on-ink)', fontSize: '11px', fontFamily: 'DM Sans', opacity: manualKeywordEn.trim() ? 1 : 0.4 }}>
                              <Plus size={12} />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* 摘录 */}
                      <div>
                        <label style={{ fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)', marginBottom: '6px', display: 'block', opacity: 0.7 }}>摘录（至少填写 1 条） <span style={{ color: 'var(--danger-text)' }}>*</span></label>
                        <div className="flex flex-col gap-3">
                          {excerpts.map((ex, i) => (
                            <div key={i} className="rounded-xl overflow-hidden" style={{ background: 'var(--card-bg-warm)', border: '1px solid var(--popup-border)' }}>
                              <div className="flex items-center justify-between px-3 py-1.5" style={{ background: 'var(--hover-bg)', borderBottom: '1px solid var(--popup-divider)' }}>
                                <span style={{ fontSize: '10px', letterSpacing: '0.04em', fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink-muted)' }}>摘录 {i + 1}</span>
                                <span style={{ fontSize: '9px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.5 }}>原文</span>
                              </div>
                              <textarea aria-label={`摘录 ${i + 1} 原文`} value={ex} onChange={e => updateExcerpt(i, e.target.value)}
                                placeholder="从原文中选取的代表性段落…"
                                rows={2}
                                style={{
                                  width: '100%', padding: '8px 12px', border: 'none', borderBottom: '1px solid var(--popup-divider)',
                                  fontSize: '13px', fontFamily: '"Lora", Georgia, serif', fontStyle: 'italic',
                                  background: 'var(--card-bg-warm)', color: 'var(--ink)', resize: 'vertical', lineHeight: 1.75,
                                }} />
                              <div className="px-3 py-1" style={{ background: 'var(--hover-bg)' }}>
                                <span style={{ fontSize: '9px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', opacity: 0.5 }}>中文翻译</span>
                              </div>
                              <textarea aria-label={`摘录 ${i + 1} 中文翻译`} value={excerptsTrans[i] || ''} onChange={e => updateExcerptTrans(i, e.target.value)}
                                placeholder="对应中文翻译…"
                                rows={2}
                                style={{
                                  width: '100%', padding: '8px 12px', border: 'none',
                                  fontSize: '12px', fontFamily: 'DM Sans',
                                  background: 'var(--card-bg-warm)', color: 'var(--ink)', resize: 'vertical', lineHeight: 1.65,
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
                            color: canGenerate ? 'var(--ink-muted)' : 'var(--ink-disabled)',
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
              <p role="alert" aria-live="polite" style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--danger-text)', marginBottom: '12px', lineHeight: 1.5 }}>{submitError}</p>
            )}

            {/* ═══ actions ═══ */}
            <div className="flex items-center justify-end gap-3" style={{ borderTop: '1px solid var(--popup-divider)', paddingTop: '16px' }}>
              {selectedItem && !hasRequiredContent && (
                <span style={{ marginRight: 'auto', fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)' }}>填写推荐语和至少一条摘录后即可提交</span>
              )}
              <button onClick={handleClose} disabled={submitting}
                style={{ padding: '9px 18px', borderRadius: '10px', border: '1px solid var(--surface-border)', background: 'transparent', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)' }}>
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
  border: '1px solid var(--surface-border)', fontSize: '13px', fontFamily: 'DM Sans',
  background: 'var(--parchment-50)', color: 'var(--ink)', marginBottom: '16px',
}

const fieldLabelStyle = {
  fontSize: '11px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)',
  marginBottom: '4px', display: 'block',
}

const inputStyle = {
  width: '100%', padding: '8px 12px', borderRadius: '10px',
  border: '1px solid var(--surface-border)', fontSize: '13px', fontFamily: 'DM Sans',
  background: 'var(--card-bg-warm)', color: 'var(--ink)',
}

