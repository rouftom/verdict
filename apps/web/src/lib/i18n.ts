import i18next, { type i18n as I18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en.json'
import fr from '@/locales/fr.json'
import zh from '@/locales/zh.json'
import hi from '@/locales/hi.json'

export type LanguageCode = 'en' | 'fr' | 'zh' | 'hi'

export interface LanguageOption {
  value: LanguageCode
  label: string
  short: string
}

/** Interface languages, mirroring the FSM globe selector and adding Mandarin and Hindi. */
export const LANGUAGES: LanguageOption[] = [
  { value: 'en', label: 'English', short: 'EN' },
  { value: 'fr', label: 'Français', short: 'FR' },
  { value: 'zh', label: '中文', short: '中文' },
  { value: 'hi', label: 'हिन्दी', short: 'हिन्दी' },
]

export const LANGUAGE_COOKIE = 'verdict-language'
export const LANGUAGE_STORAGE_KEY = 'verdict-language'
export const FALLBACK_LANGUAGE: LanguageCode = 'en'

/** Accepts a browser tag such as `fr-CA` and returns a supported language. */
export function normalizeLanguage(value: string | null | undefined): LanguageCode {
  const base = (value ?? '').toLowerCase().split('-')[0]
  const match = LANGUAGES.find((language) => language.value === base)
  return match ? match.value : FALLBACK_LANGUAGE
}

function readCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${LANGUAGE_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]!) : null
}

/**
 * Resolves the preferred language after hydration: explicit choice first,
 * then the cookie written by a previous session, then the browser locale.
 */
export function detectLanguage(): LanguageCode {
  if (typeof window === 'undefined') return FALLBACK_LANGUAGE
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored) return normalizeLanguage(stored)
  } catch {
    /* private mode or storage disabled: fall through to the cookie */
  }
  const cookie = readCookie()
  if (cookie) return normalizeLanguage(cookie)
  return normalizeLanguage(window.navigator.language)
}

/** Stores the choice for the next visit and keeps `<html lang>` in sync. */
export function persistLanguage(value: string): LanguageCode {
  const language = normalizeLanguage(value)
  if (typeof document !== 'undefined') {
    document.cookie = `${LANGUAGE_COOKIE}=${encodeURIComponent(language)}; path=/; max-age=31536000; samesite=lax`
    document.documentElement.lang = language
  }
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    /* storage can be unavailable; the cookie still carries the preference */
  }
  return language
}

/**
 * The first render is pinned to English on both the server and the client so
 * hydration matches. `I18nProvider` applies the stored preference right after
 * mounting, exactly like the FSM i18n bootstrap.
 */
const i18n: I18n = i18next.createInstance()

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: en },
    fr: { common: fr },
    zh: { common: zh },
    hi: { common: hi },
  },
  lng: FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  ns: ['common'],
  defaultNS: 'common',
  supportedLngs: LANGUAGES.map((language) => language.value),
  interpolation: { escapeValue: false },
  returnNull: false,
})

export default i18n
