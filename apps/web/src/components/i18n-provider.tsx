'use client'

import * as React from 'react'
import { I18nextProvider } from 'react-i18next'
import i18n, { detectLanguage } from '@/lib/i18n'

/** Applies the stored language after hydration, then follows every change. */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const detected = detectLanguage()
    if (detected !== i18n.language) void i18n.changeLanguage(detected)
    document.documentElement.lang = detected
  }, [])

  React.useEffect(() => {
    const onLanguageChanged = (language: string) => {
      document.documentElement.lang = language.split('-')[0] ?? language
    }
    i18n.on('languageChanged', onLanguageChanged)
    return () => i18n.off('languageChanged', onLanguageChanged)
  }, [])

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}
