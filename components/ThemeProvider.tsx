'use client'
import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'light',
  toggle: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    const stored = localStorage.getItem('elefante-theme') as Theme | null
    const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    const resolved = stored ?? system
    setTheme(resolved)
    applyTheme(resolved)
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    applyTheme(next)
    localStorage.setItem('elefante-theme', next)
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}
