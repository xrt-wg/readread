const KEY = 'readread_ai_config'
import presetModels from '../../config/presetModels.json'
import directTranslationConfig from '../../config/directTranslation.json'

const defaultPresetProvider = 'gemini-preset'
const defaultPresetModel = presetModels[defaultPresetProvider]?.defaultModel || presetModels[defaultPresetProvider]?.models?.[0] || ''

const DEFAULT = {
  provider: defaultPresetProvider,
  model: defaultPresetModel,
  apiKeys: {},
  translationMode: 'contextual',
  directProvider: directTranslationConfig.activeProvider ?? 'myMemory',
}

export const aiConfigStore = {
  get() {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? { ...DEFAULT, ...JSON.parse(raw) } : { ...DEFAULT }
    } catch {
      return { ...DEFAULT }
    }
  },

  save(config) {
    localStorage.setItem(KEY, JSON.stringify(config))
  },

  isConfigured() {
    const c = this.get()
    if (c.provider?.endsWith('-preset')) return true
    return !!c.apiKeys?.[c.provider]
  },
}
