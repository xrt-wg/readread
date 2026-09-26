import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Trash2, Brain } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { listAllBookmarks, setBookmarkStatus, deleteBookmark } from '../services/library'
import { isLibraryAccessError, resolveLibraryErrorMessage } from '../services/errorUtils'
import { computeReviewStats, formatDate, TYPE_DOT, TYPE_LABEL } from '../utils/reviewUtils'

/**
 * 统计卡（统计 Tab 内三指标：待复习 / 已掌握 / 总数）。
 * active 口径（computeReviewStats 排除归档）。
 */
function StatCard({ label, value }) {
  const isStr = typeof value === 'string'
  return (
    <div
      className="flex-1 rounded-xl px-3 py-2.5 text-center"
      style={{ background: 'var(--card-bg-warm)', border: '1px solid var(--border-subtle)' }}
    >
      <div
        style={{
          fontFamily: '"Playfair Display", Georgia, serif',
          fontSize: isStr ? '14px' : '18px',
          fontWeight: 700,
          color: 'var(--ink)',
          lineHeight: 1.2,
          fontVariantNumeric: 'tabular-nums',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: '10px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', marginTop: '3px', letterSpacing: '0.04em' }}>
        {label}
      </div>
    </div>
  )
}

/**
 * 收藏分组切换（活跃 / 生疏 / 模糊 / 熟悉 / 归档 / 统计）。
 * counts 缺省（如统计）不展示数量徽标。
 */
function GroupTabs({ tab, onTab, counts }) {
  const tabs = [
    { id: 'active', label: '活跃' },
    { id: 'hard', label: '生疏' },
    { id: 'ok', label: '模糊' },
    { id: 'easy', label: '熟悉' },
    { id: 'archived', label: '归档' },
    { id: 'stats', label: '统计' },
  ]
  return (
    <div className="flex items-center gap-1" style={{ fontFamily: 'DM Sans', flexWrap: 'wrap' }}>
      {tabs.map((t) => {
        const active = tab === t.id
        const count = counts[t.id]
        return (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              fontWeight: active ? 600 : 500,
              borderRadius: '8px',
              border: '1px solid transparent',
              background: active ? 'var(--hover-bg)' : 'transparent',
              color: active ? 'var(--ink)' : 'var(--ink-muted)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {t.label}
            {count > 0 && (
              <span style={{ marginLeft: '4px', opacity: 0.6, fontSize: '11px' }}>{count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 复习入口（占位）—— 后续接入回顾流程，当前仅图标、不可点。
 */
function ReviewButton() {
  return (
    <button
      title="复习"
      aria-label="复习"
      disabled
      className="flex items-center justify-center rounded-lg"
      style={{
        width: 32, height: 32,
        background: 'transparent',
        border: '1px solid var(--border-subtle)',
        color: 'var(--ink-muted)',
        opacity: 0.55,
        cursor: 'default',
        flexShrink: 0,
      }}
    >
      <Brain size={15} />
    </button>
  )
}

/**
 * 图标操作按钮（归档 / 恢复 / 删除）。
 * danger=true 时 hover 呈红色系（删除）。
 */
function ActionButton({ icon: Icon, title, danger = false, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="flex items-center justify-center rounded-lg transition-all"
      style={{
        width: 28, height: 28,
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        color: 'var(--ink-muted)',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.color = danger ? '#dc2626' : 'var(--gold-dark)'
        e.currentTarget.style.background = danger ? 'rgba(220,38,38,0.06)' : 'var(--hover-bg)'
      }}
      onMouseLeave={(e) => {
        if (disabled) return
        e.currentTarget.style.color = 'var(--ink-muted)'
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon size={14} />
    </button>
  )
}

/** 各分组空态副文案（tab → 提示）。 */
const EMPTY_HINTS = {
  active: '你的收藏均已归档，可在「归档」分组中恢复',
  hard: '暂无标记为「生疏」的收藏',
  ok: '暂无标记为「模糊」的收藏',
  easy: '暂无标记为「熟悉」的收藏',
  archived: '在回顾卡片或本页点击归档后，收藏会归入这里',
}

/**
 * BookmarkManager — 收藏管理区。
 *
 * 分组口径：活跃=全部未归档（总览）；生疏/模糊/熟悉=熟悉度 1/2/3+；
 * 归档=已归档；统计=复习三指标。空态区分「处处空」与「这里空」。
 */
export default function BookmarkManager() {
  const { canUseCloudLibrary, refreshAuthState, userId } = useAuth()
  const [bookmarks, setBookmarks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('active')
  const [busyId, setBusyId] = useState(null)

  const reload = useCallback(async () => {
    try {
      setError('')
      const all = await listAllBookmarks({ canUseCloudLibrary, userId })
      setBookmarks(all)
    } catch (e) {
      if (isLibraryAccessError(e)) refreshAuthState()
      setBookmarks([])
      setError(resolveLibraryErrorMessage(e, '加载收藏失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }, [canUseCloudLibrary, refreshAuthState, userId])

  useEffect(() => { reload() }, [reload])

  const runAction = useCallback(async (bookmark, fn, failText) => {
    if (busyId) return
    setBusyId(bookmark.id)
    try {
      await fn()
      await reload()
    } catch (e) {
      if (isLibraryAccessError(e)) refreshAuthState()
      setError(resolveLibraryErrorMessage(e, failText))
    } finally {
      setBusyId(null)
    }
  }, [busyId, reload, refreshAuthState, canUseCloudLibrary, userId])

  const handleArchive = useCallback((b) => {
    runAction(b, () => setBookmarkStatus(b.id, 'archived', { canUseCloudLibrary, userId }), '归档失败，请稍后重试')
  }, [runAction, canUseCloudLibrary, userId])

  const handleRestore = useCallback((b) => {
    runAction(b, () => setBookmarkStatus(b.id, 'active', { canUseCloudLibrary, userId }), '恢复失败，请稍后重试')
  }, [runAction, canUseCloudLibrary, userId])

  const handleDelete = useCallback((b) => {
    runAction(b, () => deleteBookmark(b.id, { canUseCloudLibrary, userId }), '删除失败，请稍后重试')
  }, [runAction, canUseCloudLibrary, userId])

  const stats = useMemo(() => computeReviewStats(bookmarks), [bookmarks])
  const activeItems = bookmarks.filter((b) => b.status !== 'archived')
  const archivedItems = bookmarks.filter((b) => b.status === 'archived')

  const itemsByTab = {
    active: activeItems,
    hard: activeItems.filter((b) => b.familiarity === 1),
    ok: activeItems.filter((b) => b.familiarity === 2),
    easy: activeItems.filter((b) => b.familiarity >= 3),
    archived: archivedItems,
  }
  const items = itemsByTab[tab] ?? activeItems

  const counts = {
    active: activeItems.length,
    hard: itemsByTab.hard.length,
    ok: itemsByTab.ok.length,
    easy: itemsByTab.easy.length,
    archived: archivedItems.length,
  }

  if (loading) {
    return (
      <div className="text-sm" style={{ fontFamily: 'DM Sans', color: 'var(--ink-muted)', textAlign: 'center', paddingTop: '48px' }}>
        正在加载收藏…
      </div>
    )
  }

  if (error && bookmarks.length === 0) {
    return (
      <div style={{ fontSize: '12px', fontFamily: 'DM Sans', color: '#b91c1c', textAlign: 'center', paddingTop: '48px' }}>
        {error}
      </div>
    )
  }

  return (
    <div className="w-full animate-fade-up" style={{ maxWidth: '640px', margin: '0 auto' }}>
      {/* 分组切换 + 复习入口 */}
      <div className="flex items-center justify-between mb-3" style={{ gap: '8px' }}>
        <GroupTabs tab={tab} onTab={setTab} counts={counts} />
        <ReviewButton />
      </div>

      {/* 行内错误（有数据时） */}
      {error && (
        <div style={{ marginBottom: '12px', fontSize: '12px', fontFamily: 'DM Sans', color: '#b91c1c' }}>{error}</div>
      )}

      {/* 统计视图 / 列表 / 空态 */}
      {tab === 'stats' ? (
        <div className="flex gap-2.5">
          <StatCard label="待复习" value={stats.due} />
          <StatCard label="已掌握" value={stats.mastered} />
          <StatCard label="总数" value={stats.total} />
        </div>
      ) : bookmarks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-3xl" style={{ minHeight: '240px', padding: '40px 32px', background: 'var(--card-bg-warm)', border: '1px solid var(--border-subtle)' }}>
          <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '18px', fontWeight: 600, color: 'var(--ink)', textAlign: 'center' }}>还没有收藏</p>
          <p style={{ fontSize: '13px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', textAlign: 'center', lineHeight: 1.6, opacity: 0.7 }}>阅读时划选词句并收藏<br />即可在这里统一管理</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-3xl" style={{ minHeight: '240px', padding: '40px 32px', background: 'var(--card-bg-warm)', border: '1px solid var(--border-subtle)' }}>
          <p style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: '18px', fontWeight: 600, color: 'var(--ink)', textAlign: 'center' }}>当前分组暂无内容</p>
          <p style={{ fontSize: '13px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', textAlign: 'center', lineHeight: 1.6, opacity: 0.7 }}>
            {EMPTY_HINTS[tab]}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((b) => (
            <div
              key={b.id}
              className="rounded-2xl px-5 py-4 transition-all"
              style={{ background: 'var(--card-bg-warm)', border: '1px solid var(--border-subtle)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(196,154,60,0.4)'; e.currentTarget.style.boxShadow = 'var(--card-shadow-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.boxShadow = 'none' }}
            >
              {/* 顶栏：类型锚点(左) + 操作(右) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: `${TYPE_DOT[b.type] ?? '#fbbf24'}1A`, color: TYPE_DOT[b.type] ?? '#fbbf24', borderRadius: '6px', padding: '2px 8px', fontWeight: 600, fontSize: '11px', fontFamily: 'DM Sans' }}>
                  {TYPE_LABEL[b.type] ?? '收藏'}
                </span>
                {/* 操作 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                  {b.status !== 'archived' ? (
                    <ActionButton icon={Archive} title="归档" disabled={Boolean(busyId)} onClick={() => handleArchive(b)} />
                  ) : (
                    <ActionButton icon={ArchiveRestore} title="恢复" disabled={Boolean(busyId)} onClick={() => handleRestore(b)} />
                  )}
                  <ActionButton icon={Trash2} title="删除" danger disabled={Boolean(busyId)} onClick={() => handleDelete(b)} />
                </div>
              </div>

              {/* 原文（主） */}
              <p style={{ fontFamily: '"Lora", Georgia, serif', fontSize: '15px', fontStyle: 'italic', color: 'var(--ink)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{b.text}</p>

              {/* 译文（辅） */}
              {b.translation && (
                <p style={{ fontSize: '12px', fontFamily: 'DM Sans', color: 'var(--ink-muted)', lineHeight: 1.55, marginTop: '6px', overflowWrap: 'anywhere' }}>{b.translation}</p>
              )}

              {/* 底部：来源 + 归档时间（弱化） */}
              {(b.articleTitle || (b.status === 'archived' && b.archivedAt)) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap', fontSize: '11px', fontFamily: 'DM Sans', color: 'var(--ink-muted)' }}>
                  {b.articleTitle && (
                    <span style={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', fontStyle: 'italic' }}>{b.articleTitle}</span>
                  )}
                  {b.status === 'archived' && b.archivedAt && (
                    <span style={{ opacity: 0.55 }}>归档于 {formatDate(b.archivedAt)}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
