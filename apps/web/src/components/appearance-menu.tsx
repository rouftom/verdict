'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@verdict/ui'
import { useTheme } from '@/components/theme-provider'

const MODES = [
  { value: 'light', labelKey: 'appearance.light', icon: Sun },
  { value: 'dark', labelKey: 'appearance.dark', icon: Moon },
  { value: 'system', labelKey: 'appearance.system', icon: Monitor },
] as const

const CORNERS = [
  { value: 'square', labelKey: 'appearance.square' },
  { value: 'rounded', labelKey: 'appearance.rounded' },
] as const

const groupTitle = 'text-[10px] font-semibold text-muted-foreground'

/**
 * One appearance control: colour pack, light, dark or system mode and the
 * corner treatment of the whole console, following the FSM header menu.
 */
export function AppearanceMenu() {
  const theme = useTheme()
  const { t, i18n } = useTranslation()
  const short = i18n.language?.split('-')[0] === 'fr' ? 'fr' : 'en'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('app.appearance')}>
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className={groupTitle}>{t('appearance.theme')}</DropdownMenuLabel>
        {theme.packs.map((pack) => (
          <DropdownMenuItem
            key={pack.id}
            onSelect={() => theme.setPack(pack.id)}
            className="cursor-pointer gap-2"
          >
            <span className="flex gap-0.5">
              <span className="h-3 w-3 rounded-sm" style={{ background: pack.preview.primary }} />
              <span className="h-3 w-3 rounded-sm" style={{ background: pack.preview.secondary }} />
              <span className="h-3 w-3 rounded-sm" style={{ background: pack.preview.accent }} />
            </span>
            <span className="flex-1 truncate">{pack.name[short]}</span>
            {theme.packId === pack.id ? <Check className="h-3.5 w-3.5 text-brand-primary" /> : null}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className={groupTitle}>{t('appearance.mode')}</DropdownMenuLabel>
        {MODES.map(({ value, labelKey, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => theme.setMode(value)}
            className="cursor-pointer gap-2"
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1">{t(labelKey)}</span>
            {theme.mode === value ? <Check className="h-3.5 w-3.5 text-brand-primary" /> : null}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className={groupTitle}>{t('appearance.corners')}</DropdownMenuLabel>
        {CORNERS.map(({ value, labelKey }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => theme.setRadius(value)}
            className="cursor-pointer gap-2"
          >
            <span
              className={cn(
                'h-3.5 w-3.5 border border-current text-muted-foreground',
                value === 'rounded' ? 'rounded-[4px]' : 'rounded-none',
              )}
            />
            <span className="flex-1">{t(labelKey)}</span>
            {theme.radius === value ? <Check className="h-3.5 w-3.5 text-brand-primary" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
