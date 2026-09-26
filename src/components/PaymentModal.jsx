import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { BadgeCheck, X } from 'lucide-react'
import { PAID_DAYS, formatPriceCents } from '../services/supabase'

function formatCooldownUntil(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * 付费开通弹窗（账户面板「会员权益」→「立即开通」触发）。
 * 纯展示组件：收款码、4 位核对码、待确认态、冷却态、提交逻辑均由 AuthPanel 传入。
 * pending 语义 =「已提交」（claimedAt 非空），由 AuthPanel 判别后传入。
 */
export default function PaymentModal({
  open,
  onClose,
  qr,
  qrLoading,
  pending,
  submitting,
  error,
  onSubmit,
  verificationCode,
  cooldownUntil,
  amountCents,
  requestedDays,
}) {
  useEffect(() => {
    if (!open) return undefined
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const priceText = formatPriceCents(amountCents)
  const days = requestedDays ?? PAID_DAYS
  const inCooldown = !!cooldownUntil

  return createPortal(
    <div className="pay-backdrop" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="开通 Pro"
        className="pay-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="pay-close" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>

        <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--ink)' }}>
          <BadgeCheck size={16} style={{ color: 'var(--gold-dark)' }} />
          开通 Pro
        </div>
        <p className="mt-1 text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>
          微信扫码支付 <span style={{ color: 'var(--gold-dark)', fontWeight: 600 }}>{priceText}</span>，开通 {days} 天 Pro。支付时在备注中填写核对码，支付后点击下方按钮，管理员核对到账后开通。
        </p>

        {inCooldown ? (
          <div className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--hover-bg)', color: 'var(--ink-muted)' }}>
            冷却期内暂不可申请，约 {formatCooldownUntil(cooldownUntil)} 后可重新申请
          </div>
        ) : (
          <>
            {verificationCode ? (
              <div className="mt-3 rounded-xl border border-dashed px-3 py-3 text-center" style={{ borderColor: 'var(--gold)', background: 'var(--hover-bg)' }}>
                <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>支付备注填此核对码</div>
                <div className="mt-1 text-2xl font-semibold tracking-[0.35em]" style={{ color: 'var(--gold-dark)' }}>{verificationCode}</div>
              </div>
            ) : null}

            {qrLoading ? (
              <div className="mt-3 flex h-40 items-center justify-center rounded-xl border border-dashed text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--ink-muted)' }}>
                收款码加载中…
              </div>
            ) : qr ? (
              <img src={qr} alt="微信收款码" className="mx-auto mt-3 block rounded-xl" style={{ width: 180, height: 180, objectFit: 'contain', border: '1px solid var(--surface-border)' }} />
            ) : (
              <div className="mt-3 flex h-40 items-center justify-center rounded-xl border border-dashed text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--ink-muted)' }}>
                收款码未设置，请稍后再试
              </div>
            )}

            {pending ? (
              <div className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--hover-bg)', color: 'var(--ink-muted)' }}>
                已提交，等待管理员核对到账后开通
              </div>
            ) : (
              <button
                type="button"
                onClick={onSubmit}
                disabled={submitting}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition disabled:cursor-default"
                style={{ background: 'var(--gold)', color: 'var(--on-gold)' }}
              >
                {submitting ? '提交中...' : '我已支付，申请开通'}
              </button>
            )}
          </>
        )}

        {error ? (
          <div className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{error}</div>
        ) : null}
      </section>
    </div>,
    document.body,
  )
}
