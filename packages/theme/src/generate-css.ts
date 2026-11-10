/** Builds the `data-theme-pack` CSS rules injected at runtime / build time. */

import type { ThemePack } from './types'

function declarations(tokens: Record<string, string> | undefined): string {
  if (!tokens) return ''
  return Object.entries(tokens)
    .map(([key, value]) => `${key}:${value};`)
    .join('')
}

export function buildThemePackCss(packs: ThemePack[]): string {
  return packs
    .map((pack) => {
      const shared = `:root[data-theme-pack="${pack.id}"]{${declarations(pack.tokens.common)}}`
      const light = `:root[data-theme-pack="${pack.id}"]:not(.dark){${declarations(pack.tokens.light)}}`
      const dark = `:root[data-theme-pack="${pack.id}"].dark{${declarations(pack.tokens.dark)}}`
      // Theme-aware assistant panel surface (per the admin charter).
      const surface = `
:root[data-theme-pack="${pack.id}"]{--assistant-panel-bg:color-mix(in oklab,var(--charte-primary) 30%,transparent);--app-panel-bg:var(--charte-surface)}
:root[data-theme-pack="${pack.id}"].dark{--assistant-panel-bg:color-mix(in oklab,var(--charte-primary-dark) 16%,transparent);--app-panel-bg:color-mix(in oklab,var(--charte-ink) 88%,#000)}`
      return `${shared}${light}${dark}${surface}`
    })
    .join('\n')
}
