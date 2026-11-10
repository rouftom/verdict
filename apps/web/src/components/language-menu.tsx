'use client'

import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Select } from '@verdict/ui'
import { LANGUAGES, persistLanguage } from '@/lib/i18n'

/** Globe language selector in the header, same idea as the FSM app bar. */
export function LanguageMenu() {
  const { t, i18n } = useTranslation()
  const current = i18n.language?.split('-')[0] ?? 'en'

  const changeLanguage = (value: string) => {
    const language = persistLanguage(value)
    void i18n.changeLanguage(language)
  }

  return (
    <div className="flex items-center gap-1">
      <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <Select
        value={current}
        onValueChange={changeLanguage}
        options={LANGUAGES.map((language) => ({ value: language.value, label: language.short }))}
        ariaLabel={t('app.language')}
        className="w-[68px]"
        triggerClassName="h-7 rounded-full"
      />
    </div>
  )
}
