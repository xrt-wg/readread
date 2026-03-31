import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { aiConfigStore } from '../store/aiConfig'
import { PROVIDERS, translateText } from '../services/aiProviders/index'
import directTranslationConfig from '../../config/directTranslation.json'

const PRESET_LIST = Object.entries(PROVIDERS).filter(([, p]) => p.preset).map(([id, p]) => ({ id, label: p.label, model: p.defaultModel }))
const CUSTOM_LIST = Object.entries(PROVIDERS).filter(([, p]) => !p.preset).map(([id, p]) => ({ id, label: p.label, models: p.models }))

const TEST_WORD = 'light'
const TEST_SENTENCE = 'She carried a light bag on her shoulder.'

const DIRECT_PROVIDER_LIST = Object.entries(directTranslationConfig.providers).map(([id, info]) => ({
  id,
  label: info.label,
  inactive: !!info.inactive,
}))

export default function AISettingsPanel({ open, onClose }) {
  const [config, setConfig] = useState(() => aiConfigStore.get())
  const [savedConfig, setSavedConfig] = useState(() => aiConfigStore.get())
  const [showKey, setShowKey] = useState(false)
  const [showCustom, setShowCustom] = useState(false)
  const [testStatus, setTestStatus] = useState(null)
  const [testMsg, setTestMsg] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      const c = aiConfigStore.get()
      setConfig(c)
      setSavedConfig(c)
      setShowCustom(!PROVIDERS[c.provider]?.preset)
      setTestStatus(null)
      setTestMsg('')
      setSaved(false)
    }
  }, [open])

  const isPreset = !!PROVIDERS[config.provider]?.preset
  const currentModels = PROVIDERS[config.provider]?.models ?? []
  const currentKey = config.apiKeys?.[config.provider] ?? ''
  const isDirty = JSON.stringify(config) !== JSON.stringify(savedConfig)

  function setTranslationMode(mode) {
    setConfig((c) => ({ ...c, translationMode: mode }))
  }

  function setDirectProvider(provider) {
    setConfig((c) => ({ ...c, directProvider: provider }))
  }

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
    setSavedConfig({ ...config })
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

  const labelStyle = { fontFamily: 'DM Sans', fontSize: '11px', color: 'var(--ink-muted)', fontWeight: 500, display: 'block', marginBottom: '8px', letterSpacing: '0.08em', textTransform: 'uppercase' }

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(28,25,23,0.4)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />
      <div
        className="fixed z-50 rounded-2xl overflow-hidden"
        style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '400px', background: '#fdfaf5', boxShadow: '0 24px 64px rgba(28,25,23,0.2)', border: '1px solid rgba(28,25,23,0.08)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(28,25,23,0.08)' }}>
          <p style={{ fontFamily: '"Playfair Display",Georgia,serif', fontSize: '16px', fontWeight: 600, color: 'var(--ink)' }}>翻译设置</p>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-xl transition-all"
            style={{ width: 30, height: 30, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(28,25,23,0.06)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-5">

          {/* Section 1: Translation Mode — primary control */}
          <div>
            <label style={labelStyle}>词 / 短句翻译模式</label>
            <div className="flex gap-2">
              {[{ id: 'contextual', label: '语境翻译', desc: 'AI 结合上下文分析' }, { id: 'direct', label: '直译模式', desc: '快速字面直译' }].map((m) => {
                const active = config.translationMode === m.id
                return (
                  <button
                    key={m.id}
                    onClick={() => setTranslationMode(m.id)}
                    style={{ flex: 1, padding: '10px 12px', borderRadius: '12px', border: active ? '1.5px solid var(--gold)' : '1.5px solid rgba(28,25,23,0.1)', background: active ? 'rgba(196,154,60,0.07)' : '#fff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <div style={{ fontFamily: 'DM Sans', fontSize: '13px', fontWeight: 600, color: active ? 'var(--ink)' : 'var(--ink-muted)' }}>{m.label}</div>
                    <div style={{ fontFamily: 'DM Sans', fontSize: '11px', color: active ? 'rgba(196,154,60,0.85)' : 'rgba(28,25,23,0.3)', marginTop: '3px' }}>{m.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Section 2a: Contextual → AI model config */}
          {config.translationMode === 'contextual' && (
            <div style={{ borderTop: '1px solid rgba(28,25,23,0.07)', paddingTop: '16px' }}>
              <label style={labelStyle}>语言模型</label>
              <div className="flex gap-2 mb-3">
                {PRESET_LIST.map((p) => {
                  const active = config.provider === p.id
                  return (
                    <button
                      key={p.id}
                      onClick={() => { setProvider(p.id); setShowCustom(false) }}
                      style={{ flex: 1, padding: '8px 10px', borderRadius: '10px', border: active ? '1.5px solid var(--gold)' : '1.5px solid rgba(28,25,23,0.1)', background: active ? 'rgba(196,154,60,0.07)' : '#fff', cursor: 'pointer', textAlign: 'left' }}
                    >
                      <div style={{ fontFamily: 'DM Sans', fontSize: '13px', fontWeight: 600, color: active ? 'var(--ink)' : 'var(--ink-muted)' }}>{p.label}</div>
                      <div style={{ fontFamily: 'DM Sans', fontSize: '10px', color: active ? 'var(--gold)' : 'rgba(28,25,23,0.3)', marginTop: '2px' }}>{p.model}</div>
                    </button>
                  )
                })}
              </div>

              <button
                onClick={() => { setShowCustom((v) => !v); if (!showCustom && isPreset) setProvider(CUSTOM_LIST[0]?.id ?? '') }}
                className="flex items-center gap-1.5"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: 'DM Sans', fontSize: '12px', color: showCustom ? 'var(--ink)' : 'var(--ink-muted)' }}
              >
                {showCustom ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                自定义模型
                {!isPreset && <span style={{ fontSize: '10px', color: 'var(--gold)', marginLeft: 4 }}>使用中</span>}
              </button>

              {showCustom && (
                <div className="flex flex-col gap-3 mt-3">
                  <select
                    value={isPreset ? '' : config.provider}
                    onChange={(e) => e.target.value && setProvider(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '10px', border: '1.5px solid rgba(28,25,23,0.12)', background: '#fff', fontFamily: 'DM Sans', fontSize: '13px', color: isPreset ? 'rgba(28,25,23,0.35)' : 'var(--ink)', cursor: 'pointer' }}
                  >
                    <option value="">— 选择 Provider —</option>
                    {CUSTOM_LIST.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                  {!isPreset && (
                    <>
                      <select
                        value={config.model}
                        onChange={(e) => setModel(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: '10px', border: '1.5px solid rgba(28,25,23,0.12)', background: '#fff', fontFamily: 'DM Sans', fontSize: '13px', color: 'var(--ink)', cursor: 'pointer' }}
                      >
                        {currentModels.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <div style={{ position: 'relative' }}>
                        <input
                          id="ai-api-key" name="ai-api-key"
                          type={showKey ? 'text' : 'password'}
                          value={currentKey}
                          onChange={(e) => setKey(e.target.value)}
                          placeholder={`${PROVIDERS[config.provider]?.label} API Key`}
                          autoComplete="off"
                          style={{ width: '100%', padding: '8px 36px 8px 12px', borderRadius: '10px', border: '1.5px solid rgba(28,25,23,0.12)', background: '#fff', fontFamily: 'DM Sans', fontSize: '13px', color: 'var(--ink)', boxSizing: 'border-box' }}
                        />
                        <button
                          aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                          onClick={() => setShowKey((v) => !v)}
                          style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', display: 'flex' }}
                        >
                          {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {testStatus && testStatus !== 'loading' && (
                <div
                  className="flex items-center gap-2 rounded-xl px-3 py-2 mt-3"
                  style={{ background: testStatus === 'ok' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', border: `1px solid ${testStatus === 'ok' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}` }}
                >
                  {testStatus === 'ok'
                    ? <CheckCircle2 size={14} style={{ color: '#10b981', flexShrink: 0 }} />
                    : <AlertCircle size={14} style={{ color: '#ef4444', flexShrink: 0 }} />}
                  <span style={{ fontFamily: 'DM Sans', fontSize: '12px', color: testStatus === 'ok' ? '#10b981' : '#ef4444' }}>{testMsg}</span>
                </div>
              )}
            </div>
          )}

          {/* Section 2b: Direct → service selection */}
          {config.translationMode === 'direct' && (
            <div style={{ borderTop: '1px solid rgba(28,25,23,0.07)', paddingTop: '16px' }}>
              <label style={labelStyle}>直译服务</label>
              <div className="flex gap-2">
                {DIRECT_PROVIDER_LIST.map((p) => {
                  const active = config.directProvider === p.id
                  return (
                    <button
                      key={p.id}
                      onClick={() => !p.inactive && setDirectProvider(p.id)}
                      disabled={p.inactive}
                      style={{ flex: 1, padding: '8px 10px', borderRadius: '10px', border: active ? '1.5px solid var(--gold)' : '1.5px solid rgba(28,25,23,0.1)', background: p.inactive ? 'rgba(28,25,23,0.03)' : active ? 'rgba(196,154,60,0.07)' : '#fff', cursor: p.inactive ? 'not-allowed' : 'pointer', opacity: p.inactive ? 0.45 : 1, textAlign: 'left' }}
                    >
                      <div style={{ fontFamily: 'DM Sans', fontSize: '12px', fontWeight: 600, color: active ? 'var(--ink)' : 'var(--ink-muted)' }}>{p.label}</div>
                      {p.inactive && <div style={{ fontFamily: 'DM Sans', fontSize: '10px', color: 'rgba(28,25,23,0.3)', marginTop: '1px' }}>暂未激活</div>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4" style={{ borderTop: '1px solid rgba(28,25,23,0.07)' }}>
          {config.translationMode === 'contextual' && (
            <button
              onClick={handleTest}
              disabled={(!isPreset && !currentKey) || testStatus === 'loading'}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 transition-all"
              style={{ fontFamily: 'DM Sans', fontSize: '13px', border: '1.5px solid rgba(28,25,23,0.12)', background: 'transparent', color: 'var(--ink-muted)', cursor: (!isPreset && !currentKey) ? 'not-allowed' : 'pointer', opacity: (!isPreset && !currentKey) ? 0.5 : 1 }}
              onMouseEnter={(e) => { if (isPreset || currentKey) e.currentTarget.style.background = 'rgba(28,25,23,0.05)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {testStatus === 'loading' ? <><Loader2 size={13} className="animate-spin" />测试中…</> : '连接测试'}
            </button>
          )}
          <button
            onClick={handleSave}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 transition-all"
            style={{
              fontFamily: 'DM Sans', fontSize: '13px', fontWeight: 500,
              background: saved ? 'rgba(52,211,153,0.15)' : isDirty ? 'var(--ink)' : 'rgba(28,25,23,0.08)',
              color: saved ? '#10b981' : isDirty ? '#fff' : 'rgba(28,25,23,0.35)',
              border: `1.5px solid ${saved ? 'rgba(52,211,153,0.4)' : isDirty ? 'var(--ink)' : 'rgba(28,25,23,0.1)'}`,
              cursor: isDirty ? 'pointer' : 'default',
              transition: 'all 0.2s',
            }}
          >
            {saved ? <><CheckCircle2 size={13} />已保存</> : isDirty ? '保存更改' : '已是最新'}
          </button>
        </div>
      </div>
    </>
  )
}
