const KEY = 'readread_ai_config'

const DEFAULT = {
  provider: 'gemini-preset',
  model: 'gemini-2.0-flash',
  apiKeys: {},
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
