import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { aiConfigStore } from '../store/aiConfig'
import { PROVIDERS, translateText } from '../services/aiProviders/index'

const PRESET_LIST = Object.entries(PROVIDERS).filter(([, p]) => p.preset).map(([id, p]) => ({ id, label: p.label, region: p.region, models: p.models }))
const CUSTOM_LIST = Object.entries(PROVIDERS).filter(([, p]) => !p.preset).map(([id, p]) => ({ id, label: p.label, models: p.models }))

const TEST_WORD = 'light'
const TEST_SENTENCE = 'She carried a light bag on her shoulder.'

export default function AISettingsPanel({ open, onClose }) {
  const [config, setConfig] = useState(() => aiConfigStore.get())
  const [showKey, setShowKey] = useState(false)
  const [testStatus, setTestStatus] = useState(null) // null | 'loading' | 'ok' | 'error'
  const [testMsg, setTestMsg] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      setConfig(aiConfigStore.get())
      setTestStatus(null)
      setTestMsg('')
      setSaved(false)
    }
  }, [open])

  const isPreset = !!PROVIDERS[config.provider]?.preset
  const currentModels = PROVIDERS[config.provider]?.models ?? []
  const currentKey = config.apiKeys?.[config.provider] ?? ''

  function setProvider(provider) {
    const models = PROVIDERS[provider]?.models ?? []
    setConfig((c) => ({ ...c, provider, model: models[0] ?? '' }))
    setTestStatus(null)
  }

  function setModel(model) {
    setConfig((c) => ({ ...c, model }))
    setTestStatus(null)
  }

  function setKey(val) {
    setConfig((c) => ({ ...c, apiKeys: { ...c.apiKeys, [c.provider]: val } }))
    setTestStatus(null)
  }

  function handleSave() {
    aiConfigStore.save(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleTest() {
    setTestStatus('loading')
    setTestMsg('')
    try {
      const result = await translateText(config, TEST_WORD, 'word', TEST_SENTENCE)
      if (result) {
        setTestStatus('ok')
        setTestMsg(`✓ 返回：「${result}」`)
      } else {
        setTestStatus('error')
        setTestMsg('返回结果为空')
      }
    } catch (e) {
      setTestStatus('error')
      setTestMsg(e.message ?? '连接失败')
    }
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(28,25,23,0.4)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed z-50 rounded-2xl overflow-hidden"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '400px',
          background: '#fdfaf5',
          boxShadow: '0 24px 64px rgba(28,25,23,0.2)',
          border: '1px solid rgba(28,25,23,0.08)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(28,25,23,0.08)' }}
        >
          <div>
            <p style={{ fontFamily: '"Playfair Display",Georgia,serif', fontSize: '16px', fontWeight: 600, color: 'var(--ink)' }}>
              AI 翻译设置
            </p>
            <p style={{ fontFamily: 'DM Sans', fontSize: '12px', color: 'var(--ink-muted)', marginTop: '2px' }}>
              用于词语语境义翻译
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭设置"
            className="flex items-center justify-center rounded-xl transition-all"
            style={{ width: 30, height: 30, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(28,25,23,0.06)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Preset providers */}
          <div>
            <label style={{ fontFamily: 'DM Sans', fontSize: '11px', color: 'var(--ink-muted)', fontWeight: 500, display: 'block', marginBottom: '8px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              内置模型 · 无需配置
            </label>
            <div className="flex gap-2">
              {PRESET_LIST.map((p) => {
                const active = config.provider === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => setProvider(p.id)}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: '10px',
                      border: active ? '1.5px solid var(--gold)' : '1.5px solid rgba(28,25,23,0.1)',
                      background: active ? 'rgba(196,154,60,0.07)' : '#fff',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontFamily: 'DM Sans', fontSize: '13px', fontWeight: 600, color: active ? 'var(--ink)' : 'var(--ink-muted)' }}>{p.label}</div>
                    <div style={{ fontFamily: 'DM Sans', fontSize: '11px', color: active ? 'var(--gold)' : 'rgba(28,25,23,0.35)', marginTop: '2px' }}>{p.region} · {p.models[0]}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Custom provider */}
          <div>
            <label style={{ fontFamily: 'DM Sans', fontSize: '11px', color: 'var(--ink-muted)', fontWeight: 500, display: 'block', marginBottom: '6px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              自定义模型
            </label>
            <select
              value={isPreset ? '' : config.provider}
              onChange={(e) => e.target.value && setProvider(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '10px',
                border: '1.5px solid rgba(28,25,23,0.12)',
                background: '#fff',
                fontFamily: 'DM Sans',
                fontSize: '13px',
                color: isPreset ? 'rgba(28,25,23,0.35)' : 'var(--ink)',
                cursor: 'pointer',
              }}
            >
              <option value="">— 选择自定义 Provider —</option>
              {CUSTOM_LIST.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Model */}
          <div>
            <label style={{ fontFamily: 'DM Sans', fontSize: '12px', color: 'var(--ink-muted)', fontWeight: 500, display: 'block', marginBottom: '6px' }}>
              模型
            </label>
            <select
              value={config.model}
              onChange={(e) => setModel(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '10px',
                border: '1.5px solid rgba(28,25,23,0.12)',
                background: '#fff',
                fontFamily: 'DM Sans',
                fontSize: '13px',
                color: 'var(--ink)',
                cursor: 'pointer',
              }}
            >
              {currentModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* API Key — only for custom providers */}
          {!isPreset && (
            <div>
              <label style={{ fontFamily: 'DM Sans', fontSize: '12px', color: 'var(--ink-muted)', fontWeight: 500, display: 'block', marginBottom: '6px' }}>
                API Key
              </label>
              <div className="flex items-center gap-2" style={{ position: 'relative' }}>
                <input
                  id="ai-api-key"
                  name="ai-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={currentKey}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={`输入 ${PROVIDERS[config.provider]?.label} API Key`}
                  autoComplete="off"
                  style={{
                    flex: 1,
                    padding: '8px 36px 8px 12px',
                    borderRadius: '10px',
                    border: '1.5px solid rgba(28,25,23,0.12)',
                    background: '#fff',
                    fontFamily: 'DM Sans',
                    fontSize: '13px',
                    color: 'var(--ink)',
                  }}
                />
                <button
                  aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                  onClick={() => setShowKey((v) => !v)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--ink-muted)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          )}

          {/* Test result */}
          {testStatus && testStatus !== 'loading' && (
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{
                background: testStatus === 'ok' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
                border: `1px solid ${testStatus === 'ok' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
              }}
            >
              {testStatus === 'ok'
                ? <CheckCircle2 size={14} style={{ color: '#10b981', flexShrink: 0 }} />
                : <AlertCircle size={14} style={{ color: '#ef4444', flexShrink: 0 }} />}
              <span style={{ fontFamily: 'DM Sans', fontSize: '12px', color: testStatus === 'ok' ? '#10b981' : '#ef4444' }}>
                {testMsg}
              </span>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div
          className="flex items-center gap-2 px-5 py-4"
          style={{ borderTop: '1px solid rgba(28,25,23,0.07)' }}
        >
          <button
            onClick={handleTest}
            disabled={(!isPreset && !currentKey) || testStatus === 'loading'}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 transition-all"
            style={{
              fontFamily: 'DM Sans',
              fontSize: '13px',
              border: '1.5px solid rgba(28,25,23,0.12)',
              background: 'transparent',
              color: 'var(--ink-muted)',
              cursor: (!isPreset && !currentKey) ? 'not-allowed' : 'pointer',
              opacity: (!isPreset && !currentKey) ? 0.5 : 1,
            }}
            onMouseEnter={(e) => { if (isPreset || currentKey) e.currentTarget.style.background = 'rgba(28,25,23,0.05)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            {testStatus === 'loading'
              ? <><Loader2 size={13} className="animate-spin" />测试中…</>
              : '连接测试'}
          </button>

          <button
            onClick={handleSave}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 transition-all"
            style={{
              fontFamily: 'DM Sans',
              fontSize: '13px',
              fontWeight: 500,
              background: saved ? 'rgba(52,211,153,0.15)' : 'var(--ink)',
              color: saved ? '#10b981' : '#fff',
              border: `1.5px solid ${saved ? 'rgba(52,211,153,0.4)' : 'var(--ink)'}`,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {saved ? <><CheckCircle2 size={13} />已保存</> : '保存'}
          </button>
        </div>
      </div>
    </>
  )
}
