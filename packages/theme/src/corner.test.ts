import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CORNER_STYLE,
  RADIUS_STORAGE_KEY,
  THEME_PACKS,
  buildChromeBootstrapScript,
  resolveCornerStyle,
} from './index'

describe('corner style option', () => {
  test('accepts rounded and square, rounded by default', () => {
    expect(DEFAULT_CORNER_STYLE).toBe('rounded')
    expect(resolveCornerStyle('square')).toBe('square')
    expect(resolveCornerStyle('rounded')).toBe('rounded')
    expect(resolveCornerStyle('pill')).toBe('rounded')
    expect(resolveCornerStyle(null)).toBe('rounded')
  })

  test('the pre-paint bootstrap applies the stored radius', () => {
    const script = buildChromeBootstrapScript({
      themeStorageKey: 'theme',
      modeStorageKey: 'mode',
      defaultThemeId: THEME_PACKS[0]!.id,
      themes: THEME_PACKS,
      radiusStorageKey: RADIUS_STORAGE_KEY,
      defaultRadius: DEFAULT_CORNER_STYLE,
    })
    expect(script).toContain('data-radius')
    expect(script).toContain(RADIUS_STORAGE_KEY)
  })
})
