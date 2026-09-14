import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'

const ThemeContext = createContext(null)

const STORAGE_KEY = 'readread-theme'

// ── 临时：日间盲选候选循环顺序（确定后恢复二态 parchment/night） ──
const THEME_ORDER = ['day-a', 'day-b', 'day-c', 'day-d', 'day-e', 'night']

function normalizeTheme(stored) {
  if (stored === 'parchment') return 'day-a' // 旧值兼容
  return THEME_ORDER.includes(stored) ? stored : 'day-a'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      return normalizeTheme(localStorage.getItem(STORAGE_KEY))
    } catch {
      return 'day-a'
    }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch { /* quota exceeded — ignore */ }
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(t => {
      const i = THEME_ORDER.indexOf(t)
      return THEME_ORDER[(i + 1) % THEME_ORDER.length]
    })
  }, [])

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
