'use client'

import * as React from 'react'
import {
  BORDER_STORAGE_KEY,
  DEFAULT_BORDER_STYLE,
  DEFAULT_CORNER_STYLE,
  DEFAULT_THEME_PACK_ID,
  MODE_STORAGE_KEY,
  RADIUS_STORAGE_KEY,
  THEME_PACKS,
  THEME_PACK_STORAGE_KEY,
  getThemePack,
  resolveBorderStyle,
  resolveCornerStyle,
  resolveMode,
  surfaceFor,
  type BorderStyle,
  type CornerStyle,
  type ThemeMode,
  type ThemePack,
} from '@verdict/theme'

interface ThemeContextValue {
  packId: string
  mode: ThemeMode
  radius: CornerStyle
  borderStyle: BorderStyle
  packs: ThemePack[]
  setPack: (id: string) => void
  setMode: (mode: ThemeMode) => void
  setRadius: (radius: CornerStyle) => void
  setBorderStyle: (style: BorderStyle) => void
  toggleMode: () => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

function applyChrome(pack: ThemePack, mode: ThemeMode) {
  if (typeof document === 'undefined') return
  const meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', surfaceFor(pack, mode))
    meta.removeAttribute('media')
  }
  const scheme = document.head.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (scheme) scheme.setAttribute('content', mode)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [packId, setPackId] = React.useState(DEFAULT_THEME_PACK_ID)
  const [mode, setModeState] = React.useState<ThemeMode>('light')
  const [radius, setRadiusState] = React.useState<CornerStyle>(DEFAULT_CORNER_STYLE)
  const [borderStyle, setBorderStyleState] = React.useState<BorderStyle>(DEFAULT_BORDER_STYLE)
  const packRef = React.useRef(packId)
  const modeRef = React.useRef<ThemeMode>(mode)

  // The pre-paint script already applied the stored choice; sync React state.
  React.useEffect(() => {
    const storedMode = resolveMode(localStorage.getItem(MODE_STORAGE_KEY))
    const storedPack = getThemePack(localStorage.getItem(THEME_PACK_STORAGE_KEY) ?? DEFAULT_THEME_PACK_ID)
    const storedRadius = resolveCornerStyle(localStorage.getItem(RADIUS_STORAGE_KEY))
    const storedBorder = resolveBorderStyle(localStorage.getItem(BORDER_STORAGE_KEY))
    packRef.current = storedPack.id
    modeRef.current = storedMode
    setPackId(storedPack.id)
    setModeState(storedMode)
    setRadiusState(storedRadius)
    setBorderStyleState(storedBorder)
    document.documentElement.setAttribute('data-theme-pack', storedPack.id)
    document.documentElement.classList.toggle('dark', storedMode === 'dark')
    document.documentElement.dataset.radius = storedRadius
    document.documentElement.dataset.borderStyle = storedBorder
    applyChrome(storedPack, storedMode)
  }, [])

  const setPack = React.useCallback((id: string) => {
    const pack = getThemePack(id)
    packRef.current = pack.id
    setPackId(pack.id)
    localStorage.setItem(THEME_PACK_STORAGE_KEY, pack.id)
    document.documentElement.setAttribute('data-theme-pack', pack.id)
    applyChrome(pack, modeRef.current)
  }, [])

  const setMode = React.useCallback((next: ThemeMode) => {
    modeRef.current = next
    setModeState(next)
    localStorage.setItem(MODE_STORAGE_KEY, next)
    document.documentElement.classList.toggle('dark', next === 'dark')
    applyChrome(getThemePack(packRef.current), next)
  }, [])

  const setRadius = React.useCallback((next: CornerStyle) => {
    const value: CornerStyle = next === 'rounded' ? 'rounded' : DEFAULT_CORNER_STYLE
    setRadiusState(value)
    localStorage.setItem(RADIUS_STORAGE_KEY, value)
    document.documentElement.dataset.radius = value
  }, [])

  const setBorderStyle = React.useCallback((next: BorderStyle) => {
    const value = resolveBorderStyle(next)
    setBorderStyleState(value)
    localStorage.setItem(BORDER_STORAGE_KEY, value)
    document.documentElement.dataset.borderStyle = value
  }, [])

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      packId,
      mode,
      radius,
      borderStyle,
      packs: THEME_PACKS,
      setPack,
      setMode,
      setRadius,
      setBorderStyle,
      toggleMode: () => setMode(mode === 'dark' ? 'light' : 'dark'),
    }),
    [packId, mode, radius, borderStyle, setPack, setMode, setRadius, setBorderStyle],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
