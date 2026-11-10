import { describe, expect, test } from 'bun:test'
import { DEFAULT_THEME_MODE, resolveMode, resolveModeValue } from './index'

describe('theme mode', () => {
  test('accepts light, dark and system, system by default', () => {
    expect(DEFAULT_THEME_MODE).toBe('system')
    expect(resolveMode('light')).toBe('light')
    expect(resolveMode('dark')).toBe('dark')
    expect(resolveMode('system')).toBe('system')
    expect(resolveMode('sepia')).toBe('system')
    expect(resolveMode(null)).toBe('system')
  })

  test('system follows the OS while an explicit choice wins', () => {
    expect(resolveModeValue('system', true)).toBe('dark')
    expect(resolveModeValue('system', false)).toBe('light')
    expect(resolveModeValue('dark', false)).toBe('dark')
    expect(resolveModeValue('light', true)).toBe('light')
  })
})
