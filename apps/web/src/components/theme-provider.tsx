'use client'

import * as React from 'react'
import {
  DEFAULT_CORNER_STYLE,
  DEFAULT_THEME_PACK_ID,
  MODE_STORAGE_KEY,
  RADIUS_STORAGE_KEY,
  THEME_PACKS,
  THEME_PACK_STORAGE_KEY,
  getThemePack,
  resolveCornerStyle,
  resolveMode,
  resolveModeValue,
  surfaceFor,
  type CornerStyle,
  type ResolvedMode,
  type ThemeMode,
  type ThemePack,
} from '@verdict/theme'

interface ThemeContextValue {
  packId: string
  /** The operator's preference: light, dark or system. */
  mode: ThemeMode
  /** What is actually painted right now. */
  resolvedMode: ResolvedMode
  radius: CornerStyle
  packs: ThemePack[]
  setPack: (id: string) => void
  setMode: (mode: ThemeMode) => void
  setRadius: (radius: CornerStyle) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

function applyChrome(pack: ThemePack, mode: ResolvedMode) {
  if (typeof document === 'undefined') return
  const meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', surfaceFor(pack, mode))
    meta.removeAttribute('media')
  }
  const scheme = document.head.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (scheme) scheme.setAttribute('content', mode)
}

function prefersDarkNow(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [packId, setPackId] = React.useState(DEFAULT_THEME_PACK_ID)
  const [mode, setModeState] = React.useState<ThemeMode>(resolveMode(undefined))
  const [systemDark, setSystemDark] = React.useState(() => prefersDarkNow())
  const [radius, setRadiusState] = React.useState<CornerStyle>(DEFAULT_CORNER_STYLE)

  const resolvedMode = resolveModeValue(mode, systemDark)

  // The pre-paint script already applied the stored choice; sync React state.
  React.useEffect(() => {
    const storedMode = resolveMode(localStorage.getItem(MODE_STORAGE_KEY))
    const storedPack = getThemePack(localStorage.getItem(THEME_PACK_STORAGE_KEY) ?? DEFAULT_THEME_PACK_ID)
    const storedRadius = resolveCornerStyle(localStorage.getItem(RADIUS_STORAGE_KEY))
    setPackId(storedPack.id)
    setModeState(storedMode)
    setSystemDark(prefersDarkNow())
    setRadiusState(storedRadius)
    document.documentElement.setAttribute('data-theme-pack', storedPack.id)
    document.documentElement.dataset.radius = storedRadius
  }, [])

  // Automatic detection: follow the OS while the preference is `system`.
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setSystemDark(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  // Apply the resolved mode and pack whenever either changes.
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedMode === 'dark')
    applyChrome(getThemePack(packId), resolvedMode)
  }, [packId, resolvedMode])

  const setPack = React.useCallback((id: string) => {
    const pack = getThemePack(id)
    setPackId(pack.id)
    localStorage.setItem(THEME_PACK_STORAGE_KEY, pack.id)
    document.documentElement.setAttribute('data-theme-pack', pack.id)
  }, [])

  const setMode = React.useCallback((next: ThemeMode) => {
    const value = resolveMode(next)
    setModeState(value)
    localStorage.setItem(MODE_STORAGE_KEY, value)
    document.documentElement.dataset.mode = value
  }, [])

  const setRadius = React.useCallback((next: CornerStyle) => {
    const value = resolveCornerStyle(next)
    setRadiusState(value)
    localStorage.setItem(RADIUS_STORAGE_KEY, value)
    document.documentElement.dataset.radius = value
  }, [])

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      packId,
      mode,
      resolvedMode,
      radius,
      packs: THEME_PACKS,
      setPack,
      setMode,
      setRadius,
    }),
    [packId, mode, resolvedMode, radius, setPack, setMode, setRadius],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
