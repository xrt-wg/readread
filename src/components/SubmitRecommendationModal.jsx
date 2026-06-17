import { useState, useEffect } from 'react'
import { Sparkles, X, Plus, AlertCircle } from 'lucide-react'
import { checkSubmissionEligibility } from '../services/supabase'

export default function SubmitRecommendationModal({ userId, importItems, preSelectedId, onClose, onSubmitted }) {
  const [eligibleItems, setEligibleItems] = useState([])
  const [checking, setChecking] = useState(true)
  const [selectedId, setSelectedId] = useState(preSelectedId || '')
  const [intro, setIntro] = useState('')
  const [keywords, setKeywords] = useState([])
  const [keywordInput, setKeywordInput] = useState('')
  const [excerpts, setExcerpts] = useState([''])
  const [submitting, setSubmitting] = useState(false)
  const [eligibilityMsg, setEligibilityMsg] = useState('')

  // 批量预取可提交的 item
  useEffect(() => {
    let active = true
    async function check() {
      setChecking(true)
      const results = []
      // 仅检查 origin === 'imported' 的 item
      const candidates = importItems.filter(i => i.origin === 'imported')
      for (const item of candidates) {
        try {
          const { canSubmit } = await checkSubmissionEligibility(userId, item.id)
          if (canSubmit) results.push(item)
        } catch (_) { /* 跳过 */ }
      }
      if (active) {
        setEligibleItems(results)
        setChecking(false)
        if (results.length === 0) {
          setEligibilityMsg('暂无可提交的内容——导入一篇文章、读完它、就可以来推荐。')
        }
      }
    }
    check()
    return () => { active = false }
  }, [userId, importItems])

  // 若预选了某 item 且它在 eligible 中，自动选中
  useEffect(() => {
    if (preSelectedId && eligibleItems.some(i => i.id === preSelectedId)) {
      setSelectedId(preSelectedId)
    }
  }, [preSelectedId, eligibleItems])

  function addKeyword() {
    const kw = keywordInput.trim()
    if (kw && !keywords.includes(kw) && keywords.length < 5) {
      setKeywords([...keywords, kw])
      setKeywordInput('')
    }
  }

  function removeKeyword(kw) {
    setKeywords(keywords.filter(k => k !== kw))
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addKeyword()
    }
  }

  async function handleSubmit() {
    if (!selectedId || !intro.trim() || !excerpts.some(e => e.trim())) return
    setSubmitting(true)
    try {
      const { submitRecommendation } = await import('../services/supabase')
      await submitRecommendation({ importItemId: selectedId, intro, keywords, excerpts }, userId)
      onSubmitted()
    } catch (e) {
      setEligibilityMsg(e.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(28,25,23,0.45)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-3xl p-8 w-full animate-fade-up" style={{ maxWidth: '520px', background: '#ffffff', boxShadow: '0 8px 40px rgba(28,25,23,0.18)', margin: '16px' }}>
        {/* header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Sparkles size={15} style={{ color: 'var(--gold)' }} />
            <span style={{ fontSize: '15px', fontFamily: 'DM Sans', fontWeight: 600, color: 'var(--ink)' }}>提交推荐</span>
          </div>
          <button onClick={onClose}
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
            {/* 选择素材 */}
            <label style={{ fontSize: '12px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink)', marginBottom: '6px', display: 'block' }}>选择书架内容</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '12px', border: '1px solid rgba(28,25,23,0.12)', fontSize: '13px', fontFamily: 'DM Sans', background: 'var(--parchment-50)', color: 'var(--ink)', marginBottom: '16px' }}>
              <option value="">请选择…</option>
              {eligibleItems.map(item => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>

            {/* 介绍 */}
            <label style={{ fontSize: '12px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink)', marginBottom: '6px', display: 'block' }}>介绍</label>
            <textarea value={intro} onChange={e => setIntro(e.target.value)}
              placeholder="为什么推荐这篇文章？它好在哪里？"
              rows={3}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '12px', border: '1px solid rgba(28,25,23,0.12)', fontSize: '13px', fontFamily: 'DM Sans', background: 'var(--parchment-50)', color: 'var(--ink)', resize: 'vertical', marginBottom: '12px' }} />

            {/* 关键词 */}
            <label style={{ fontSize: '12px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink)', marginBottom: '6px', display: 'block' }}>关键词（最多 5 个）</label>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {keywords.map(kw => (
                <span key={kw} className="flex items-center gap-1" style={{ fontSize: '11px', fontFamily: 'DM Sans', background: 'rgba(196,154,60,0.1)', color: 'var(--gold-dark)', borderRadius: '6px', padding: '2px 8px', fontWeight: 500 }}>
                  {kw}
                  <button onClick={() => removeKeyword(kw)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--gold-dark)', padding: 0, lineHeight: 1 }}><X size={10} /></button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 mb-12">
              <input value={keywordInput} onChange={e => setKeywordInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder="输入后回车添加…"
                style={{ flex: 1, padding: '8px 12px', borderRadius: '10px', border: '1px solid rgba(28,25,23,0.12)', fontSize: '12px', fontFamily: 'DM Sans', background: 'var(--parchment-50)', color: 'var(--ink)' }} />
              <button onClick={addKeyword} disabled={!keywordInput.trim() || keywords.length >= 5}
                style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: 'var(--ink)', color: '#fff', fontSize: '12px', fontFamily: 'DM Sans', opacity: !keywordInput.trim() || keywords.length >= 5 ? 0.4 : 1 }}>
                <Plus size={13} />
              </button>
            </div>

            {/* 摘录（多条） */}
            <label style={{ fontSize: '12px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink)', marginBottom: '6px', display: 'block' }}>摘录（1-5 条）</label>
            {excerpts.map((ex, i) => (
              <div key={i} className="flex items-start gap-2" style={{ marginBottom: '6px' }}>
                <textarea value={ex} onChange={e => {
                  const next = [...excerpts]
                  next[i] = e.target.value
                  setExcerpts(next)
                }}
                  placeholder={`摘录 ${i + 1}：从原文中选取一段代表性文字…`}
                  rows={2}
                  style={{ flex: 1, padding: '10px 12px', borderRadius: '12px', border: '1px solid rgba(28,25,23,0.12)', fontSize: '13px', fontFamily: 'DM Sans', background: 'var(--parchment-50)', color: 'var(--ink)', resize: 'vertical' }} />
                {excerpts.length > 1 && (
                  <button onClick={() => setExcerpts(excerpts.filter((_, j) => j !== i))}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: '8px 4px', fontSize: '14px' }}>×</button>
                )}
              </div>
            ))}
            {excerpts.length < 5 && (
              <button onClick={() => setExcerpts([...excerpts, ''])}
                style={{ padding: '5px 14px', borderRadius: '8px', border: '1px dashed rgba(28,25,23,0.18)', background: 'transparent', cursor: 'pointer', fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', marginBottom: '12px' }}>
                + 添加摘录
              </button>
            )}

            {eligibilityMsg && (
              <p style={{ fontSize: '11px', fontFamily: 'DM Sans', color: '#dc2626', marginBottom: '12px' }}>{eligibilityMsg}</p>
            )}

            {/* actions */}
            <div className="flex items-center justify-end gap-3" style={{ borderTop: '1px solid rgba(28,25,23,0.06)', paddingTop: '16px' }}>
              <button onClick={onClose}
                style={{ padding: '9px 18px', borderRadius: '10px', border: '1px solid rgba(28,25,23,0.12)', background: 'transparent', cursor: 'pointer', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, color: 'var(--ink-muted)' }}>
                取消
              </button>
              <button onClick={handleSubmit} disabled={!selectedId || !intro.trim() || !excerpts.some(e => e.trim()) || submitting}
                style={{ padding: '9px 18px', borderRadius: '10px', border: 'none', cursor: (!selectedId || !intro.trim() || !excerpts.some(e => e.trim())) ? 'default' : 'pointer', background: 'var(--ink)', color: '#fff', fontSize: '13px', fontFamily: 'DM Sans', fontWeight: 500, opacity: !selectedId || !intro.trim() || !excerpts.some(e => e.trim()) ? 0.4 : 1 }}>
                {submitting ? '提交中…' : '提交推荐'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
