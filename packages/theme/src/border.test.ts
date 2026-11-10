import { describe, expect, test } from 'bun:test'
import {
  BORDER_STORAGE_KEY,
  BORDER_STYLES,
  DEFAULT_BORDER_STYLE,
  THEME_PACKS,
  buildChromeBootstrapScript,
  resolveBorderStyle,
} from './index'

describe('border style option', () => {
  test('accepts only the three supported hairlines', () => {
    expect(BORDER_STYLES).toEqual(['solid', 'dashed', 'dotted'])
    expect(resolveBorderStyle('dashed')).toBe('dashed')
    expect(resolveBorderStyle('dotted')).toBe('dotted')
    expect(resolveBorderStyle('double')).toBe(DEFAULT_BORDER_STYLE)
    expect(resolveBorderStyle(null)).toBe('solid')
  })

  test('the pre-paint bootstrap applies the stored style', () => {
    const script = buildChromeBootstrapScript({
      themeStorageKey: 'theme',
      modeStorageKey: 'mode',
      defaultThemeId: THEME_PACKS[0]!.id,
      themes: THEME_PACKS,
      borderStorageKey: BORDER_STORAGE_KEY,
      defaultBorder: DEFAULT_BORDER_STYLE,
    })
    expect(script).toContain('data-border-style')
    expect(script).toContain(BORDER_STORAGE_KEY)
  })
})
