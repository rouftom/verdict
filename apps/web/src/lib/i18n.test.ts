import { describe, expect, test } from 'bun:test'
import en from '../locales/en.json'
import fr from '../locales/fr.json'
import zh from '../locales/zh.json'
import hi from '../locales/hi.json'

type Messages = { [key: string]: string | Messages }

function flatten(messages: Messages, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'string' ? [path] : flatten(value, path)
  })
}

function valueAt(messages: Messages, path: string): string {
  return path.split('.').reduce<string | Messages>((node, key) => (node as Messages)[key] ?? '', messages) as string
}

const locales = { en, fr, zh, hi }

describe('locale resources', () => {
  test('every English key exists in French and Hindi', () => {
    const enKeys = flatten(en)
    for (const [language, messages] of Object.entries({ fr, hi })) {
      const keys = new Set(flatten(messages))
      const missing = enKeys.filter((key) => !keys.has(key))
      expect({ language, missing }).toEqual({ language, missing: [] })
    }
  })

  test('Chinese carries every non singular English key', () => {
    // Chinese has a single plural category, so `_one` variants are intentionally absent.
    const keys = new Set(flatten(zh))
    const missing = flatten(en).filter((key) => !key.endsWith('_one') && !keys.has(key))
    expect(missing).toEqual([])
  })

  test('no locale contains an em dash', () => {
    for (const [language, messages] of Object.entries(locales)) {
      const offenders = flatten(messages).filter((key) => valueAt(messages, key).includes('\u2014'))
      expect({ language, offenders }).toEqual({ language, offenders: [] })
    }
  })
})
