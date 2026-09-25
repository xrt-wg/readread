import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getFeedbackQr, setFeedbackQr } from '../services/supabase'
import { isLibraryAccessError } from '../services/errorUtils'

/**
 * 意见反馈设置：管理员上传/替换/清除账号面板「意见反馈」容器展示的微信二维码。
 * 文案「会员时长奖励」本轮仅为引导话术，不落地发放逻辑。
 */
export default function FeedbackSettingsPanel() {
  const { refreshAuthState } = useAuth()
  const [qrUrl, setQrUrl] = useState(null)
  const [qrSaving, setQrSaving] = useState(false)
  const [qrError, setQrError] = useState('')
  const fileInputRef = useRef(null)
  const alive = useRef(false)

  useEffect(() => {
    alive.current = true
    getFeedbackQr().then((url) => { if (alive.current) setQrUrl(url) }).catch(() => {})
    return () => { alive.current = false }
  }, [])

  async function handleQrFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setQrError('图片过大，请使用 2MB 以内的二维码图片')
      return
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('读取图片失败'))
      reader.readAsDataURL(file)
    })
    setQrSaving(true)
    setQrError('')
    try {
      await setFeedbackQr(dataUrl)
      setQrUrl(dataUrl)
    } catch (failure) {
      setQrError(failure.message || '上传失败，请稍后重试')
      if (isLibraryAccessError(failure)) refreshAuthState()
    } finally {
      setQrSaving(false)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleClearQr() {
    if (!window.confirm('清除当前反馈二维码？')) return
    setQrSaving(true)
    setQrError('')
    try {
      await setFeedbackQr(null)
      setQrUrl(null)
    } catch (failure) {
      setQrError(failure.message || '清除失败，请稍后重试')
      if (isLibraryAccessError(failure)) refreshAuthState()
    } finally {
      setQrSaving(false)
    }
  }

  return (
    <section className="rounded-3xl border p-5 sm:p-7" style={{ background: 'var(--card-bg-warm)', borderColor: 'var(--border-subtle)' }}>
      <div className="mb-6">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>意见反馈</h2>
        <p className="mt-2 text-sm leading-6" style={{ color: 'var(--ink-muted)' }}>
          账号面板「意见反馈」容器展示给用户的微信二维码；用户扫码添加后反馈问题或建议，可随时替换或清除。
        </p>
      </div>

      <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--popup-bg)' }}>
        <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>微信二维码</div>
        <p className="mt-1 text-xs leading-5" style={{ color: 'var(--ink-muted)' }}>上传后账号面板「意见反馈」展开即展示；建议使用清晰可扫的微信名片二维码。</p>
        <div className="mt-3 flex items-center gap-4">
          {qrUrl ? (
            <img src={qrUrl} alt="反馈微信二维码" className="rounded-lg" style={{ width: 96, height: 96, objectFit: 'contain', border: '1px solid var(--surface-border)' }} />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed text-xs" style={{ borderColor: 'var(--surface-border)', color: 'var(--ink-muted)' }}>未设置</div>
          )}
          <div className="flex flex-col gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleQrFile} className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={qrSaving}
              className="rounded-xl px-3 py-2 text-sm font-medium transition disabled:cursor-default"
              style={{ background: 'var(--gold)', color: 'var(--on-gold)' }}
            >
              {qrSaving ? '处理中...' : '上传二维码'}
            </button>
            {qrUrl ? (
              <button
                type="button"
                onClick={handleClearQr}
                disabled={qrSaving}
                className="rounded-xl px-3 py-2 text-sm font-medium"
                style={{ border: '1px solid var(--border-subtle)', color: 'var(--ink-muted)' }}
              >
                清除
              </button>
            ) : null}
          </div>
        </div>
        {qrError ? <div className="mt-2 text-xs" style={{ color: 'var(--danger-text)' }}>{qrError}</div> : null}
      </div>
    </section>
  )
}
