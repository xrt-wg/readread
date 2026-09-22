import { useEffect, useMemo, useRef, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { getGrowthStats } from '../services/supabase'
import { isLibraryAccessError, resolveLibraryErrorMessage } from '../services/errorUtils'
import AdminStatCard from './AdminStatCard'

const GRANULARITY_WINDOW_DAYS = {
  day: 90,
  week: 365,
  month: 730,
}

const GRANULARITY_OPTIONS = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
]

function formatBucket(bucket, granularity) {
  if (!bucket) return ''
  return granularity === 'month' ? String(bucket).slice(0, 7) : String(bucket).slice(5)
}

function niceMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return nice * magnitude
}

const CHART_PADDING = { top: 16, right: 16, bottom: 26, left: 44 }

function TrendChart({ labels, series, granularity, area = false, height = 220 }) {
  const containerRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [hoverIndex, setHoverIndex] = useState(null)

  const count = labels.length

  const yMax = useMemo(() => {
    const max = Math.max(0, ...series.flatMap((s) => s.values.map((v) => Number(v) || 0)))
    return niceMax(max)
  }, [series])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (count === 0) {
    return (
      <div className="rounded-2xl border px-4 py-8 text-center text-sm" style={{ color: 'var(--ink-muted)', borderColor: 'var(--popup-border)', background: 'var(--surface-bg)' }}>
        暂无数据
      </div>
    )
  }

  const innerWidth = Math.max(0, width - CHART_PADDING.left - CHART_PADDING.right)
  const innerHeight = height - CHART_PADDING.top - CHART_PADDING.bottom

  const xFor = (index) => {
    if (count <= 1) return CHART_PADDING.left + innerWidth / 2
    return CHART_PADDING.left + (index / (count - 1)) * innerWidth
  }
  const yFor = (value) => CHART_PADDING.top + innerHeight - (Number(value) / yMax) * innerHeight

  const linePathFor = (values) => values
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`)
    .join(' ')

  const areaPathFor = (values) => {
    const baseline = yFor(0).toFixed(1)
    const line = values
      .map((value, index) => `${index === 0 ? 'M' : 'L'}${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`)
      .join(' ')
    return `${line} L${xFor(count - 1).toFixed(1)},${baseline} L${xFor(0).toFixed(1)},${baseline} Z`
  }

  const yTicks = Array.from({ length: 5 }, (_, i) => yMax * (i / 4))
  const labelStep = Math.max(1, Math.ceil(count / 6))

  const handleMouseMove = (event) => {
    if (count === 0 || innerWidth === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    const innerX = event.clientX - rect.left - CHART_PADDING.left
    const ratio = innerX / innerWidth
    setHoverIndex(Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1)))))
  }

  return (
    <div ref={containerRef} className="relative w-full" onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIndex(null)}>
      <svg
        width={width}
        height={height}
        style={{ display: 'block' }}
        role="img"
        aria-label={series.map((s) => s.name).join('、')}
      >
        {yTicks.map((tick) => {
          const y = yFor(tick)
          return (
            <g key={tick}>
              <line x1={CHART_PADDING.left} x2={width - CHART_PADDING.right} y1={y} y2={y} stroke="var(--popup-divider)" strokeWidth={1} />
              <text x={CHART_PADDING.left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="var(--ink-muted)">
                {Number.isInteger(tick) ? tick : tick.toFixed(1)}
              </text>
            </g>
          )
        })}

        {area ? series.map((s) => (
          <path key={`area-${s.name}`} d={areaPathFor(s.values)} fill={s.color} style={{ opacity: 0.12 }} />
        )) : null}

        {series.map((s) => (
          <path
            key={s.name}
            d={linePathFor(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {hoverIndex !== null ? (
          <line x1={xFor(hoverIndex)} x2={xFor(hoverIndex)} y1={CHART_PADDING.top} y2={height - CHART_PADDING.bottom} stroke="var(--ink-muted)" strokeWidth={1} strokeDasharray="3 3" />
        ) : null}

        {labels.map((label, index) => {
          if (index % labelStep !== 0 && index !== count - 1) return null
          return (
            <text key={`${label}-${index}`} x={xFor(index)} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--ink-muted)">
              {formatBucket(label, granularity)}
            </text>
          )
        })}
      </svg>

      {hoverIndex !== null ? (
        <div
          className="pointer-events-none absolute rounded-xl border px-3 py-2 text-xs"
          style={{
            background: 'var(--card-bg-warm)',
            borderColor: 'var(--popup-border)',
            boxShadow: 'var(--popup-shadow)',
            color: 'var(--ink)',
            left: `${xFor(hoverIndex)}px`,
            top: 8,
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ color: 'var(--ink-muted)', marginBottom: '4px' }}>{labels[hoverIndex]}</div>
          {series.map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: s.color, flexShrink: 0 }} />
              <span>{s.name}：{s.values[hoverIndex] ?? 0}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Section({ title, hint, children }) {
  return (
    <section className="rounded-3xl border p-6" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--popup-border)' }}>
      <div className="mb-4">
        <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{title}</div>
        {hint ? <div className="mt-1 text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>{hint}</div> : null}
      </div>
      {children}
    </section>
  )
}

export default function GrowthStatsPanel() {
  const { refreshAuthState } = useAuth()
  const [granularity, setGranularity] = useState('day')
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let isActive = true

    async function loadStats() {
      setLoading(true)
      setError('')

      try {
        const result = await getGrowthStats({
          granularity,
          windowDays: GRANULARITY_WINDOW_DAYS[granularity],
        })
        if (isActive) setStats(result)
      } catch (loadError) {
        if (!isActive) return
        if (isLibraryAccessError(loadError)) refreshAuthState()
        setError(resolveLibraryErrorMessage(loadError, '数据统计加载失败，请稍后重试'))
      } finally {
        if (isActive) setLoading(false)
      }
    }

    loadStats()

    return () => {
      isActive = false
    }
  }, [granularity, refreshAuthState])

  const snapshot = stats?.snapshot
  const series = stats?.series || []
  const retention = stats?.retention

  const labels = series.map((row) => row.bucket)
  const seriesByLabel = (label) => series.map((row) => row[label])

  const isEmpty = !loading && !error && (!stats || !snapshot || Number(snapshot.total_users) === 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2" style={{ color: 'var(--ink-light)' }}>
          <TrendingUp size={18} />
          <span className="text-sm font-medium">用户增长与使用趋势</span>
        </div>
        <div className="flex gap-1 rounded-2xl border p-1" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)' }}>
          {GRANULARITY_OPTIONS.map((option) => {
            const isActive = granularity === option.key
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setGranularity(option.key)}
                className="rounded-xl px-3 py-1.5 text-sm font-medium transition"
                style={{
                  background: isActive ? 'var(--ink)' : 'transparent',
                  color: isActive ? 'var(--on-ink)' : 'var(--ink-muted)',
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl border p-6 text-sm" style={{ borderColor: 'var(--popup-border)', background: 'var(--card-bg-warm)', color: 'var(--ink-muted)' }}>
          正在加载数据统计...
        </div>
      ) : error ? (
        <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>
          {error}
        </div>
      ) : isEmpty ? (
        <div className="rounded-3xl border px-4 py-12 text-center text-sm" style={{ borderColor: 'var(--popup-border)', background: 'var(--card-bg-warm)', color: 'var(--ink-muted)' }}>
          当前暂无用户数据可供统计。
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <AdminStatCard label="用户总量" value={snapshot?.total_users ?? 0} />
            <AdminStatCard label="今日新增" value={snapshot?.today_new_users ?? 0} />
            <AdminStatCard label="DAU（打开应用）" value={snapshot?.dau ?? 0} />
            <AdminStatCard label="WAU（打开应用）" value={snapshot?.wau ?? 0} />
            <AdminStatCard label="MAU（打开应用）" value={snapshot?.mau ?? 0} />
          </div>

          <Section title="新增注册趋势" hint="各时间桶的新注册用户数。">
            <TrendChart labels={labels} granularity={granularity} area series={[{ name: '新增注册', color: 'var(--gold)', values: seriesByLabel('new_users') }]} />
          </Section>

          <Section title="累计用户增长" hint="各时间点已注册的用户总量。">
            <TrendChart labels={labels} granularity={granularity} area series={[{ name: '累计用户', color: 'var(--ink)', values: seriesByLabel('cumulative_users') }]} />
          </Section>

          <Section title="活跃用户趋势（有产出 · 近似）" hint="「新增阅读或收藏」的去重用户数（近似，非登录活跃）。">
            <TrendChart labels={labels} granularity={granularity} series={[{ name: '活跃用户', color: 'var(--teal)', values: seriesByLabel('active_users') }]} />
          </Section>

          <Section title="阅读活跃趋势" hint="开始读 / 读完 / 新增阅读（重新阅读时会重置为最近一次）。">
            <TrendChart
              labels={labels}
              granularity={granularity}
              series={[
                { name: '开始读', color: 'var(--gold)', values: seriesByLabel('reading_started') },
                { name: '读完', color: 'var(--teal)', values: seriesByLabel('reading_finished') },
                { name: '新增阅读', color: 'var(--ink-light)', values: seriesByLabel('new_readings') },
              ]}
            />
          </Section>

          <Section title="留存（累计 · 近似）" hint="注册后 N 天内仍有产出的用户占比，与粒度无关。">
            <div className="grid gap-4 md:grid-cols-3">
              {[['d1', '1 日内留存'], ['d7', '7 日内留存'], ['d30', '30 日内留存']].map(([key, label]) => (
                <div key={key} className="rounded-2xl border p-5" style={{ borderColor: 'var(--popup-border)', background: 'var(--surface-bg)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--ink-muted)', marginBottom: '8px' }}>{label}</div>
                  <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--ink)' }}>
                    {retention?.[key] != null ? `${retention[key]}%` : '—'}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
