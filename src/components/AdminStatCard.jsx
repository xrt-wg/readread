export default function AdminStatCard({ label, value, tone = 'default' }) {
  const color = tone === 'warning' ? 'var(--warning-text)' : tone === 'success' ? 'var(--success-text)' : 'var(--ink)'
  const background = tone === 'warning' ? 'var(--warning-bg)' : tone === 'success' ? 'var(--success-bg)' : 'var(--surface-bg)'

  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        background,
        borderColor: 'var(--popup-border)',
      }}
    >
      <div style={{ fontSize: '12px', color: 'var(--ink-muted)', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '26px', fontWeight: 700, color }}>{value}</div>
    </div>
  )
}
