import { useEffect, useMemo, useState } from 'react'
import { Check, Eye, FilePenLine, RefreshCw, Send, X } from 'lucide-react'
import {
  approveRecommendation,
  listRecommendationModerationQueue,
  publishRecommendation,
  rejectRecommendation,
  removePublishedRecommendation,
  updateRecommendationEditorial,
} from '../services/supabase/recommendationService'

const statusMeta = {
  pending: ['待审核', 'var(--warning-bg)', 'var(--warning-text)'],
  approved: ['已通过，待发布', 'var(--surface-bg)', 'var(--ink)'],
  active: ['已发布', 'var(--success-bg)', 'var(--success-text)'],
  rejected: ['已驳回', 'var(--warning-bg)', 'var(--warning-text)'],
  removed: ['已下架', 'var(--hover-bg)', 'var(--ink-muted)'],
}

function toLines(values) { return (values || []).join('\n') }
function fromLines(value) { return value.split('\n').map((item) => item.trim()).filter(Boolean) }

function StatusBadge({ status }) {
  const [label, background, color] = statusMeta[status] || [status, 'var(--surface-bg)', 'var(--ink-muted)']
  return <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background, color }}>{label}</span>
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

  const selected = items.find((item) => item.id === selectedId) || null
  const visibleItems = useMemo(() => filter === 'all' ? items : items.filter((item) => item.status === filter), [filter, items])

  function syncForm(item) {
    setForm(item ? {
      title: item.title || '', author: item.author || '', sourceUrl: item.sourceUrl || '', intro: item.intro || '',
      keywords: toLines(item.keywords), keywordsTrans: toLines(item.keywordsTrans),
      excerpts: toLines(item.excerpts), excerptsTrans: toLines(item.excerptsTrans),
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
  const editorial = () => ({
    title: form.title, author: form.author, sourceUrl: form.sourceUrl, intro: form.intro,
    keywords: fromLines(form.keywords || ''), keywordsTrans: fromLines(form.keywordsTrans || ''),
    excerpts: fromLines(form.excerpts || ''), excerptsTrans: fromLines(form.excerptsTrans || ''), internalNote: form.internalNote,
  })

  return <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
    <section className="rounded-3xl border p-4" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--popup-border)' }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>提交队列</div><div className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>{items.length} 条记录，按状态处理</div></div>
        <button type="button" onClick={() => loadQueue()} disabled={loading} aria-label="刷新审核队列" className="rounded-xl p-2 disabled:opacity-50" style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}><RefreshCw size={15} /></button>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {['pending', 'approved', 'active', 'removed', 'rejected', 'all'].map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className="rounded-full px-2.5 py-1 text-xs" style={{ background: filter === value ? 'var(--ink)' : 'var(--hover-bg)', color: filter === value ? 'var(--on-ink)' : 'var(--ink-muted)' }}>{value === 'all' ? '全部' : statusMeta[value][0]}</button>)}
      </div>
      <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
        {loading ? <p className="py-8 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>正在加载…</p> : visibleItems.length === 0 ? <p className="py-8 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>当前没有此状态的提交</p> : visibleItems.map((item) => <button key={item.id} type="button" onClick={() => choose(item)} className="w-full rounded-2xl border p-3 text-left" style={{ borderColor: item.id === selectedId ? 'var(--ink-light)' : 'var(--popup-border)', background: item.id === selectedId ? 'var(--surface-bg)' : 'transparent' }}><div className="flex items-start justify-between gap-2"><span className="line-clamp-2 text-sm font-medium" style={{ color: 'var(--ink)' }}>{item.title}</span><StatusBadge status={item.status} /></div><div className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>{item.author || '未署名'} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}</div></button>)}
      </div>
    </section>
    <section className="rounded-3xl border p-5 md:p-6" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--popup-border)' }}>
      {!selected ? <div className="py-20 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>从左侧选择一条提交，开始审核。</div> : <>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b pb-5" style={{ borderColor: 'var(--popup-border)' }}><div><div className="flex items-center gap-2"><FilePenLine size={18} style={{ color: 'var(--ink-light)' }} /><h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>{selected.title}</h2></div><p className="mt-2 text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>用户提交于 {new Date(selected.createdAt).toLocaleString('zh-CN')}。已发布内容必须先下架，才能编辑。</p></div><StatusBadge status={selected.status} /></div>
        {error ? <div className="mb-4 rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>{error}</div> : null}
        {message ? <div className="mb-4 rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--success-bg)', color: 'var(--success-text)' }}>{message}</div> : null}
        <div className="grid gap-4 md:grid-cols-2">
          {[['标题', 'title'], ['作者', 'author'], ['来源链接（可选）', 'sourceUrl']].map(([label, key]) => <label key={key} className={key === 'sourceUrl' ? 'md:col-span-2' : ''}><span className="mb-1.5 block text-xs" style={{ color: 'var(--ink-muted)' }}>{label}</span><input value={form[key] || ''} disabled={!editable || saving} onChange={(event) => patch(key, event.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm disabled:opacity-60" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)', color: 'var(--ink)' }} /></label>)}
          <label className="md:col-span-2"><span className="mb-1.5 block text-xs" style={{ color: 'var(--ink-muted)' }}>推荐语（发布必填）</span><textarea value={form.intro || ''} disabled={!editable || saving} onChange={(event) => patch('intro', event.target.value)} rows={3} className="w-full rounded-xl border px-3 py-2 text-sm disabled:opacity-60" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)', color: 'var(--ink)' }} /></label>
          {[['标签，每行一个', 'keywords'], ['标签翻译，每行一个', 'keywordsTrans'], ['摘录，每行一条（1–5 条才可发布）', 'excerpts'], ['摘录翻译，每行一条', 'excerptsTrans']].map(([label, key]) => <label key={key}><span className="mb-1.5 block text-xs" style={{ color: 'var(--ink-muted)' }}>{label}</span><textarea value={form[key] || ''} disabled={!editable || saving} onChange={(event) => patch(key, event.target.value)} rows={4} className="w-full rounded-xl border px-3 py-2 text-sm disabled:opacity-60" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)', color: 'var(--ink)' }} /></label>)}
          <label className="md:col-span-2"><span className="mb-1.5 block text-xs" style={{ color: 'var(--ink-muted)' }}>内部备注（仅管理员可见）</span><textarea value={form.internalNote || ''} disabled={saving} onChange={(event) => patch('internalNote', event.target.value)} rows={2} className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)', color: 'var(--ink)' }} /></label>
        </div>
        {selected.status === 'pending' || selected.status === 'approved' ? <label className="mt-4 block"><span className="mb-1.5 block text-xs" style={{ color: 'var(--ink-muted)' }}>驳回原因（仅在驳回时必填，提交者可见）</span><input value={form.reason || ''} disabled={saving} onChange={(event) => patch('reason', event.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)', color: 'var(--ink)' }} /></label> : null}
        {selected.status === 'active' ? <label className="mt-4 block"><span className="mb-1.5 block text-xs" style={{ color: 'var(--ink-muted)' }}>下架原因（提交者可见）</span><input value={form.reason || ''} disabled={saving} onChange={(event) => patch('reason', event.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)', color: 'var(--ink)' }} /></label> : null}
        <div className="mt-5 flex flex-wrap gap-2 border-t pt-5" style={{ borderColor: 'var(--popup-border)' }}>
          {editable ? <button type="button" disabled={saving} onClick={() => run(() => updateRecommendationEditorial(selected.id, editorial()), '人工填写内容已保存')} className="rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--hover-bg)', color: 'var(--ink)' }}><span className="inline-flex items-center gap-1.5"><FilePenLine size={15} />保存填写</span></button> : null}
          {selected.status === 'pending' || selected.status === 'removed' ? <button type="button" disabled={saving} onClick={() => run(() => approveRecommendation(selected.id, form.internalNote), '审核已通过，等待发布')} className="rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--success-bg)', color: 'var(--success-text)' }}><span className="inline-flex items-center gap-1.5"><Check size={15} />通过审核</span></button> : null}
          {selected.status === 'pending' || selected.status === 'approved' ? <button type="button" disabled={saving} onClick={() => run(() => rejectRecommendation(selected.id, form.reason || '', form.internalNote), '已驳回，提交者可查看原因')} className="rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}><span className="inline-flex items-center gap-1.5"><X size={15} />驳回</span></button> : null}
          {selected.status === 'approved' ? <button type="button" disabled={saving} onClick={() => run(() => publishRecommendation(selected.id, form.internalNote), '推荐已发布')} className="rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--ink)', color: 'var(--on-ink)' }}><span className="inline-flex items-center gap-1.5"><Send size={15} />发布</span></button> : null}
          {selected.status === 'active' ? <button type="button" disabled={saving} onClick={() => run(() => removePublishedRecommendation(selected.id, form.reason || '', form.internalNote), '已下架；现在可修改后重新通过并发布')} className="rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-60" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}><span className="inline-flex items-center gap-1.5"><Eye size={15} />下架</span></button> : null}
        </div>
      </>}
    </section>
  </div>
}
