import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ChevronUp, Eye, FilePenLine, FileText, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react'
import {
  approveRecommendation,
  getRecommendationModerationDetail,
  listRecommendationModerationQueue,
  publishRecommendation,
  rejectRecommendation,
  removePublishedRecommendation,
  updateRecommendationContent,
  updateRecommendationEditorial,
} from '../services/supabase/recommendationService'
import SectionContentEditor, { SectionPreview } from './SectionContentEditor'

const statusMeta = {
  pending: ['待审核', 'var(--warning-bg)', 'var(--warning-text)'],
  approved: ['已通过，待发布', 'var(--surface-bg)', 'var(--ink)'],
  active: ['已发布', 'var(--success-bg)', 'var(--success-text)'],
  rejected: ['已驳回', 'var(--warning-bg)', 'var(--warning-text)'],
  removed: ['已下架', 'var(--hover-bg)', 'var(--ink-muted)'],
}

function zipPairs(listA, listB) {
  const a = listA || []
  const b = listB || []
  const len = Math.max(a.length, b.length)
  return Array.from({ length: len }, (_, i) => ({ text: a[i] || '', trans: b[i] || '' }))
}

function pairsToArrays(pairs) {
  const kept = (pairs || []).filter((p) => p.text.trim())
  return {
    texts: kept.map((p) => p.text.trim()),
    trans: kept.map((p) => p.trans.trim()),
  }
}

function StatusBadge({ status }) {
  const [label, background, color] = statusMeta[status] || [status, 'var(--surface-bg)', 'var(--ink-muted)']
  return <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background, color }}>{label}</span>
}

function PairListEditor({
  pairs = [],
  onChange,
  textLabel,
  transLabel,
  textPlaceholder = '',
  transPlaceholder = '',
  textRows = 1,
  transRows = 1,
  max,
  countHint = '',
  longText = false,
  disabled = false,
  addLabel = '添加',
}) {
  function update(index, key, value) {
    onChange(pairs.map((pair, i) => (i === index ? { ...pair, [key]: value } : pair)))
  }
  function move(index, delta) {
    const target = index + delta
    if (target < 0 || target >= pairs.length) return
    const next = pairs.slice()
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    onChange(next)
  }
  function remove(index) {
    onChange(pairs.filter((_, i) => i !== index))
  }
  function add() {
    onChange([...pairs, { text: '', trans: '' }])
  }

  const filledCount = pairs.filter((pair) => pair.text.trim()).length
  const atMax = typeof max === 'number' && pairs.length >= max

  const controlStyle = {
    width: '100%',
    borderRadius: '12px',
    border: '1px solid var(--popup-border)',
    background: 'var(--surface-bg)',
    color: 'var(--ink)',
    padding: '8px 10px',
    fontSize: '14px',
    outline: 'none',
  }

  return (
    <div className="space-y-2">
      {pairs.length === 0 ? (
        <div className="rounded-2xl border px-4 py-6 text-center text-sm" style={{ color: 'var(--ink-muted)', borderColor: 'var(--popup-border)', background: 'var(--surface-bg)' }}>
          暂未填写{textLabel}。
        </div>
      ) : (
        pairs.map((pair, index) => {
          const missingText = Boolean(pair.trans.trim() && !pair.text.trim())
          return (
            <div key={index} className="group grid grid-cols-[20px_minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1">
              <span className="pt-2 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>{index + 1}</span>
              <label className="min-w-0">
                <span className="sr-only">{textLabel}</span>
                {longText ? (
                  <textarea value={pair.text} disabled={disabled} rows={textRows} placeholder={textPlaceholder} onChange={(event) => update(index, 'text', event.target.value)} className="w-full disabled:opacity-60" style={{ ...controlStyle, borderColor: missingText ? 'var(--warning-text)' : 'var(--popup-border)' }} />
                ) : (
                  <input value={pair.text} disabled={disabled} placeholder={textPlaceholder} onChange={(event) => update(index, 'text', event.target.value)} className="w-full disabled:opacity-60" style={{ ...controlStyle, borderColor: missingText ? 'var(--warning-text)' : 'var(--popup-border)' }} />
                )}
              </label>
              <label className="min-w-0">
                <span className="sr-only">{transLabel}</span>
                {longText ? (
                  <textarea value={pair.trans} disabled={disabled} rows={transRows} placeholder={transPlaceholder} onChange={(event) => update(index, 'trans', event.target.value)} className="w-full disabled:opacity-60" style={controlStyle} />
                ) : (
                  <input value={pair.trans} disabled={disabled} placeholder={transPlaceholder} onChange={(event) => update(index, 'trans', event.target.value)} className="w-full disabled:opacity-60" style={controlStyle} />
                )}
              </label>
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button type="button" disabled={disabled || index === 0} onClick={() => move(index, -1)} aria-label={`上移第 ${index + 1} 条`} className="rounded-lg p-1 disabled:opacity-30" style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}><ChevronUp size={15} /></button>
                <button type="button" disabled={disabled || index === pairs.length - 1} onClick={() => move(index, 1)} aria-label={`下移第 ${index + 1} 条`} className="rounded-lg p-1 disabled:opacity-30" style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}><ChevronDown size={15} /></button>
                <button type="button" disabled={disabled} onClick={() => remove(index)} aria-label={`删除第 ${index + 1} 条`} className="rounded-lg p-1 disabled:opacity-30" style={{ background: 'var(--hover-bg)', color: 'var(--danger-text)' }}><Trash2 size={15} /></button>
              </div>
              {missingText ? <span className="col-span-4 -mt-0.5 text-xs" style={{ color: 'var(--warning-text)' }}>请先填写原文，否则本条不会保存</span> : null}
            </div>
          )
        })
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" disabled={disabled || atMax} onClick={add} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium disabled:opacity-40" style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}><Plus size={15} />{addLabel}</button>
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {typeof max === 'number' ? `已填 ${filledCount}/${max} 条${countHint ? `（${countHint}）` : ''}` : (countHint || `已填 ${filledCount} 条`)}
        </span>
      </div>
    </div>
  )
}

export default function RecommendationModerationPanel() {
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({})
  const [detail, setDetail] = useState(null)
  const [contentEditing, setContentEditing] = useState(false)
  const [draftSections, setDraftSections] = useState([])
  const [contentModalOpen, setContentModalOpen] = useState(false)
  const [reasonModalOpen, setReasonModalOpen] = useState(false)
  const [reasonModalAction, setReasonModalAction] = useState(null)
  const [auditOpen, setAuditOpen] = useState(false)

  const selected = items.find((item) => item.id === selectedId) || null
  const visibleItems = useMemo(() => filter === 'all' ? items : items.filter((item) => item.status === filter), [filter, items])
  const statusCounts = useMemo(() => items.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc }, {}), [items])

  function syncForm(item) {
    setForm(item ? {
      title: item.title || '', author: item.author || '', sourceUrl: item.sourceUrl || '', intro: item.intro || '',
      keywords: zipPairs(item.keywords, item.keywordsTrans),
      excerpts: zipPairs(item.excerpts, item.excerptsTrans),
      internalNote: item.internalNote || '', reason: item.status === 'active' ? item.removalReason || '' : item.rejectionReason || '',
    } : {})
  }

  async function loadQueue(keepId = selectedId) {
    setLoading(true); setError('')
    try {
      const next = await listRecommendationModerationQueue()
      setItems(next)
      const nextId = next.some((item) => item.id === keepId) ? keepId : next[0]?.id || null
      setSelectedId(nextId)
      syncForm(next.find((item) => item.id === nextId))
    } catch (loadError) { setError(loadError.message || '审核队列加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadQueue(null) }, [])

  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    let active = true
    setContentEditing(false)
    getRecommendationModerationDetail(selectedId).then((value) => { if (active) setDetail(value) }).catch(() => { if (active) setDetail(null) })
    return () => { active = false }
  }, [selectedId])

  function choose(item) { setSelectedId(item.id); syncForm(item); setMessage(''); setError('') }
  function patch(key, value) { setForm((current) => ({ ...current, [key]: value })) }

  async function run(action, success) {
    if (!selected) return
    setSaving(true); setError(''); setMessage('')
    try { await action(); await loadQueue(selected.id); setMessage(success) }
    catch (actionError) { setError(actionError.message || '操作失败，请稍后重试') }
    finally { setSaving(false) }
  }

  const editable = selected && selected.status !== 'active' && selected.status !== 'rejected'
  const editorial = () => {
    const kw = pairsToArrays(form.keywords)
    const ex = pairsToArrays(form.excerpts)
    return {
      title: form.title, author: form.author, sourceUrl: form.sourceUrl, intro: form.intro,
      keywords: kw.texts, keywordsTrans: kw.trans,
      excerpts: ex.texts, excerptsTrans: ex.trans, internalNote: form.internalNote,
    }
  }

  // 正文展示态：策展优先，回退提交原样（L1：detail/snapshot 三级可选链空守卫）
  const displaySections = detail?.snapshot?.curated_sections ?? detail?.snapshot?.sections

  function openContentModal() {
    setContentEditing(false)
    setContentModalOpen(true)
  }

  function startContentEdit() {
    setDraftSections(structuredClone(displaySections || []))
    setContentEditing(true)
    setError(''); setMessage('')
  }

  function cancelContentEdit() {
    setContentEditing(false)
    setDraftSections([])
  }

  async function saveContent() {
    if (!selected) return
    setSaving(true); setError(''); setMessage('')
    try {
      await updateRecommendationContent(selected.id, draftSections)
      const value = await getRecommendationModerationDetail(selected.id)
      setDetail(value)
      setContentEditing(false)
      setMessage('正文已策展')
    } catch (saveError) { setError(saveError.message || '正文保存失败') }
    finally { setSaving(false) }
  }

  function openReasonModal(action) {
    setReasonModalAction(action)
    setReasonModalOpen(true)
  }

  function confirmReasonAction() {
    if (!selected) return
    const reason = form.reason || ''
    if (reasonModalAction === 'reject') {
      run(() => rejectRecommendation(selected.id, reason, form.internalNote), '已驳回，提交者可查看原因')
    } else if (reasonModalAction === 'remove') {
      run(() => removePublishedRecommendation(selected.id, reason, form.internalNote), '已下架；现在可修改后重新通过并发布')
    }
    setReasonModalOpen(false)
  }

  return <>
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="rounded-3xl border p-4" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--popup-border)' }}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>提交队列</div><div className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>{items.length} 条记录</div></div>
          <button type="button" onClick={() => loadQueue()} disabled={loading} aria-label="刷新审核队列" className="rounded-xl p-2 disabled:opacity-50" style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}><RefreshCw size={15} /></button>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {['pending', 'approved', 'active', 'removed', 'rejected', 'all'].map((value) => {
            const count = value === 'all' ? items.length : (statusCounts[value] || 0)
            return (
              <button key={value} type="button" onClick={() => setFilter(value)} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs" style={{ background: filter === value ? 'var(--ink)' : 'var(--hover-bg)', color: filter === value ? 'var(--on-ink)' : 'var(--ink-muted)' }}>
                <span>{value === 'all' ? '全部' : statusMeta[value][0]}</span>
                <span className="rounded-full px-1.5 text-[10px] leading-4" style={{ background: filter === value ? 'var(--on-ink)' : 'var(--neutral-bg)', color: filter === value ? 'var(--ink)' : 'var(--neutral-text)' }}>{count}</span>
              </button>
            )
          })}
        </div>
        <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
          {loading ? <p className="py-8 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>正在加载…</p> : visibleItems.length === 0 ? <p className="py-8 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>当前没有此状态的提交</p> : visibleItems.map((item) => <button key={item.id} type="button" onClick={() => choose(item)} className="w-full rounded-2xl border p-3 text-left" style={{ borderColor: item.id === selectedId ? 'var(--ink-light)' : 'var(--popup-border)', background: item.id === selectedId ? 'var(--surface-bg)' : 'transparent' }}><div className="flex items-start justify-between gap-2"><span className="line-clamp-2 text-sm font-medium" style={{ color: 'var(--ink)' }}>{item.title}</span><StatusBadge status={item.status} /></div><div className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>{item.author || '未署名'} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}</div></button>)}
        </div>
      </section>

      <section className="rounded-3xl border" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--popup-border)' }}>
        {!selected ? <div className="py-20 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>从左侧选择一条提交。</div> : <>
          {/* ① 顶栏常驻 */}
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-t-3xl border-b px-5 py-4" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--popup-border)' }}>
            <StatusBadge status={selected.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold" style={{ color: 'var(--ink)' }}>{selected.title}</div>
              <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>用户提交于 {new Date(selected.createdAt).toLocaleString('zh-CN')}。已发布内容需先下架才能编辑。</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {selected.status === 'pending' || selected.status === 'removed' ? <button type="button" disabled={saving} onClick={() => run(() => approveRecommendation(selected.id, form.internalNote), '审核已通过，等待发布')} className="rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--success-bg)', color: 'var(--success-text)' }}><span className="inline-flex items-center gap-1.5"><Check size={15} />通过审核</span></button> : null}
              {selected.status === 'pending' || selected.status === 'approved' ? <button type="button" disabled={saving} onClick={() => openReasonModal('reject')} className="rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}><span className="inline-flex items-center gap-1.5"><X size={15} />驳回</span></button> : null}
              {selected.status === 'approved' ? <button type="button" disabled={saving} onClick={() => run(() => publishRecommendation(selected.id, form.internalNote), '推荐已发布')} className="rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--ink)', color: 'var(--on-ink)' }}><span className="inline-flex items-center gap-1.5"><Send size={15} />发布</span></button> : null}
              {selected.status === 'active' ? <button type="button" disabled={saving} onClick={() => openReasonModal('remove')} className="rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}><span className="inline-flex items-center gap-1.5"><Eye size={15} />下架</span></button> : null}
            </div>
          </div>

          <div className="flex flex-col gap-4 p-5 md:p-6">
            {error ? <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>{error}</div> : null}
            {message ? <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--success-bg)', color: 'var(--success-text)' }}>{message}</div> : null}

            {/* ② 内容本体区 */}
            <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)' }}>
              <div className="mb-4 flex items-baseline gap-2">
                <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>内容本体</span>
                <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>读者最终会看到的模样</span>
              </div>

              <button type="button" onClick={openContentModal} className="flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm" style={{ borderColor: 'var(--popup-border)', background: 'var(--popup-surface)', color: 'var(--ink)' }}>
                <FileText size={16} style={{ color: 'var(--gold-dark)' }} />
                <span className="font-medium">正文</span>
                {detail?.snapshot?.curated_at ? <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: 'rgba(196,154,60,0.12)', color: 'var(--gold-dark)' }}>已策展</span> : null}
                {selected.snapshotMissing ? <span className="text-xs" style={{ color: 'var(--warning-text)' }}>快照缺失，需运营补录</span> : null}
                <ChevronRight size={15} className="ml-auto" style={{ color: 'var(--ink-muted)' }} />
              </button>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {[['标题', 'title'], ['作者', 'author'], ['来源链接（可选）', 'sourceUrl']].map(([label, key]) => <label key={key} className={key === 'sourceUrl' ? 'md:col-span-2' : ''}><span className="mb-1.5 block text-xs" style={{ color: 'var(--ink-muted)' }}>{label}</span><input value={form[key] || ''} disabled={!editable || saving} onChange={(event) => patch(key, event.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm disabled:opacity-60" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)', color: 'var(--ink)' }} /></label>)}
                <label className="md:col-span-2"><span className="mb-1.5 block text-xs" style={{ color: 'var(--ink-muted)' }}>推荐语（发布必填）</span><textarea value={form.intro || ''} disabled={!editable || saving} onChange={(event) => patch('intro', event.target.value)} rows={3} className="w-full rounded-xl border px-3 py-2 text-sm disabled:opacity-60" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)', color: 'var(--ink)' }} /></label>
                <div className="md:col-span-2">
                  <div className="mb-2 text-xs" style={{ color: 'var(--ink-muted)' }}>标签（英文）与中文翻译一一配对，翻译可选。</div>
                  <PairListEditor pairs={form.keywords || []} onChange={(value) => patch('keywords', value)} disabled={!editable || saving} textLabel="标签" transLabel="标签翻译" textPlaceholder="英文关键词" transPlaceholder="中文翻译" addLabel="添加标签" />
                </div>
                <div className="md:col-span-2">
                  <div className="mb-2 text-xs" style={{ color: 'var(--ink-muted)' }}>摘录请从原文逐字摘抄（不改写），中文翻译可选。</div>
                  <PairListEditor pairs={form.excerpts || []} onChange={(value) => patch('excerpts', value)} disabled={!editable || saving} textLabel="摘录" transLabel="摘录翻译" textPlaceholder="从原文逐字摘抄的英文原句" transPlaceholder="中文翻译" longText textRows={3} transRows={3} max={5} countHint="发布需 1–5 条" addLabel="添加摘录" />
                </div>
              </div>

              {editable ? <div className="mt-4 flex justify-end"><button type="button" disabled={saving} onClick={() => run(() => updateRecommendationEditorial(selected.id, editorial()), '人工填写内容已保存')} className="rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}><span className="inline-flex items-center gap-1.5"><FilePenLine size={15} />保存填写</span></button></div> : null}
            </section>

            {/* ③ 管理信息区 */}
            <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)' }}>
              <div className="mb-4 flex items-baseline gap-2">
                <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>管理信息</span>
                <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>仅后台流转使用，不展示给读者</span>
              </div>
              <label>
                <span className="mb-1.5 block text-xs" style={{ color: 'var(--ink-muted)' }}>内部备注</span>
                <textarea value={form.internalNote || ''} disabled={saving} onChange={(event) => patch('internalNote', event.target.value)} rows={2} className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)', color: 'var(--ink)' }} />
              </label>
              <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>驳回 / 下架原因在对应按钮弹窗中填写。</p>
            </section>

            {/* ④ 审计区（折叠） */}
            <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)' }}>
              <button type="button" onClick={() => setAuditOpen((v) => !v)} className="flex w-full items-center gap-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
                <ChevronDown size={14} style={{ transform: auditOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                审计详情
              </button>
              {auditOpen ? <div className="mt-3 space-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                <div>内容指纹：<code className="break-all" style={{ color: 'var(--ink-light)' }}>{detail?.snapshot?.content_hash || '正在加载…'}</code></div>
                <div>提交：{new Date(selected.createdAt).toLocaleString('zh-CN')}</div>
                <div>通过：{selected.approvedAt ? new Date(selected.approvedAt).toLocaleString('zh-CN') : '—'}</div>
                <div>发布：{selected.publishedAt ? new Date(selected.publishedAt).toLocaleString('zh-CN') : '—'}</div>
                <div>下架：{selected.removedAt ? new Date(selected.removedAt).toLocaleString('zh-CN') : '—'}</div>
                <div>最近审核：{detail?.reviewed_at ? new Date(detail.reviewed_at).toLocaleString('zh-CN') : '—'}</div>
              </div> : null}
            </section>
          </div>
        </>}
      </section>
    </div>

    {/* 正文弹窗（查看 + 编辑） */}
    {contentModalOpen && selected ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(3px)' }} onClick={(event) => { if (event.target === event.currentTarget) setContentModalOpen(false) }}>
        <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-3xl" style={{ background: 'var(--popup-bg)', boxShadow: 'var(--popup-shadow)' }}>
          <div className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--popup-border)' }}>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold" style={{ color: 'var(--ink)' }}>正文</div>
              <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--ink-muted)' }}>{selected.title} · 快照预览与策展编辑</div>
            </div>
            {!contentEditing && !selected.snapshotMissing && Array.isArray(displaySections) ? <button type="button" onClick={startContentEdit} className="rounded-xl px-3.5 py-2 text-sm font-medium" style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}><span className="inline-flex items-center gap-1.5"><FilePenLine size={15} />编辑</span></button> : null}
            <button type="button" onClick={() => setContentModalOpen(false)} aria-label="关闭" className="rounded-xl p-2" style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}><X size={16} /></button>
          </div>
          <div className="overflow-y-auto px-5 py-4">
            {selected.snapshotMissing ? <p className="py-10 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>该历史记录没有可用正文快照，不能开放新的加入书架。</p> : !Array.isArray(displaySections) ? <p className="py-10 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>正在加载正文快照…</p> : contentEditing ? <SectionContentEditor sections={draftSections} onChange={setDraftSections} /> : <SectionPreview sections={displaySections} />}
          </div>
          {contentEditing ? <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--popup-border)' }}>
            <button type="button" disabled={saving} onClick={cancelContentEdit} className="rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}>取消</button>
            <button type="button" disabled={saving} onClick={saveContent} className="rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--ink)', color: 'var(--on-ink)' }}>保存正文</button>
          </div> : null}
        </div>
      </div>
    ) : null}

    {/* 驳回 / 下架弹窗 */}
    {reasonModalOpen && selected ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(3px)' }} onClick={(event) => { if (event.target === event.currentTarget) setReasonModalOpen(false) }}>
        <div className="w-full max-w-md rounded-3xl" style={{ background: 'var(--popup-bg)', boxShadow: 'var(--popup-shadow)' }}>
          <div className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--popup-border)' }}>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold" style={{ color: 'var(--ink)' }}>{reasonModalAction === 'reject' ? '驳回原因' : '下架原因'}</div>
              <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>原因将展示给提交者。</div>
            </div>
            <button type="button" onClick={() => setReasonModalOpen(false)} aria-label="关闭" className="rounded-xl p-2" style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}><X size={16} /></button>
          </div>
          <div className="px-5 py-4">
            <label>
              <span className="mb-1.5 block text-xs" style={{ color: 'var(--ink-muted)' }}>原因（必填）</span>
              <textarea value={form.reason || ''} disabled={saving} onChange={(event) => patch('reason', event.target.value)} rows={3} autoFocus className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)', color: 'var(--ink)' }} placeholder={reasonModalAction === 'reject' ? '例如：摘录未逐字摘抄，请从原文核对后重新提交。' : '例如：内容存在版权争议，暂时下架。'} />
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--popup-border)' }}>
            <button type="button" onClick={() => setReasonModalOpen(false)} className="rounded-xl px-3.5 py-2 text-sm font-medium" style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}>取消</button>
            <button type="button" disabled={saving || !(form.reason || '').trim()} onClick={confirmReasonAction} className="rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>{reasonModalAction === 'reject' ? '确认驳回' : '确认下架'}</button>
          </div>
        </div>
      </div>
    ) : null}
  </>
}
