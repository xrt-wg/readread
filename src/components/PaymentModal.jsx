import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BadgeCheck, Check, Copy, X } from 'lucide-react'
import { copyText } from '../utils/clipboard'

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
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const inCooldown = !!cooldownUntil

  async function handleCopyCode() {
    const ok = await copyText(`ReadRead 会员 核对码 ${verificationCode}`)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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

        {inCooldown ? (
          <div className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--hover-bg)', color: 'var(--ink-muted)' }}>
            冷却期内暂不可申请，约 {formatCooldownUntil(cooldownUntil)} 后可重新申请
          </div>
        ) : pending ? (
          <div className="mt-3 rounded-xl px-3 py-4 text-center" style={{ background: 'var(--success-bg)' }}>
            <BadgeCheck size={22} style={{ color: 'var(--success-text)' }} className="mx-auto" />
            <div className="mt-1.5 text-sm font-medium" style={{ color: 'var(--success-text)' }}>已提交，等待管理员核对到账后开通</div>
            <div className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>开通后账号面板将自动刷新为 Pro</div>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 rounded-xl px-3 py-1.5 text-xs font-medium"
              style={{ border: '1px solid var(--border-subtle)', color: 'var(--ink)' }}
            >
              完成
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4">
              <div className="mb-1.5 flex items-center text-xs font-medium" style={{ color: 'var(--ink)' }}>
                <span className="mr-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-medium" style={{ background: 'var(--gold)', color: 'var(--on-gold)' }}>1</span>
                支付时在备注中填此核对码
              </div>
              {verificationCode ? (
                <div className="rounded-xl border border-dashed px-3 py-3 text-center" style={{ borderColor: 'var(--gold)', background: 'var(--hover-bg)' }}>
                  <div className="text-2xl font-semibold tracking-[0.35em]" style={{ color: 'var(--gold-dark)' }}>{verificationCode}</div>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition"
                    style={{ border: '1px solid var(--gold)', color: 'var(--gold-dark)' }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? '已复制' : '复制核对码'}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center text-xs font-medium" style={{ color: 'var(--ink)' }}>
                <span className="mr-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-medium" style={{ background: 'var(--gold)', color: 'var(--on-gold)' }}>2</span>
                扫码支付
              </div>
              {qrLoading ? (
                <div className="flex h-40 items-center justify-center rounded-xl border border-dashed text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--ink-muted)' }}>
                  收款码加载中…
                </div>
              ) : qr ? (
                <img src={qr} alt="微信收款码" className="mx-auto block rounded-xl" style={{ width: 180, height: 180, objectFit: 'contain', border: '1px solid var(--surface-border)' }} />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-xl border border-dashed text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--ink-muted)' }}>
                  收款码未设置，请稍后再试
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center text-xs font-medium" style={{ color: 'var(--ink)' }}>
              <span className="mr-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-medium" style={{ background: 'var(--gold)', color: 'var(--on-gold)' }}>3</span>
              支付完成后，回来点击下方按钮
            </div>

            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition disabled:cursor-default"
              style={{ background: 'var(--gold)', color: 'var(--on-gold)' }}
            >
              {submitting ? '提交中...' : '我已支付，申请开通'}
            </button>
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
