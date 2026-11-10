/** Browser-chrome theming (theme-color metas, app tile, OS color-scheme). */

import type { ThemePack } from './types'

export type ThemeMode = 'light' | 'dark'

/**
 * Light is the console default. `system` remains an explicit operator choice,
 * but the absence of a stored preference never silently flips the demo to dark.
 */
export function resolveMode(preferred?: string | null): ThemeMode {
  return preferred === 'dark' ? 'dark' : 'light'
}

function upsertMeta(name: string): HTMLMetaElement {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', name)
    document.head.appendChild(meta)
  }
  return meta
}

/** Page background of a pack for a given mode (chrome bar / tile colour). */
export function surfaceFor(pack: ThemePack, mode: ThemeMode): string {
  return (mode === 'dark' ? pack.tokens.dark['--background'] : pack.tokens.light['--background']) ?? pack.preview.surface
}

/** Push the active pack colors onto the browser chrome metas. */
export function applyBrowserChrome(pack: ThemePack, mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  const isDark = mode === 'dark'
  const color = surfaceFor(pack, mode)

  const metas = Array.from(document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
  const list = metas.length > 0 ? metas : [upsertMeta('theme-color')]
  const [owner, ...others] = list
  if (owner) {
    owner.setAttribute('content', color)
    owner.removeAttribute('media')
  }
  for (const other of others) {
    other.setAttribute('media', 'not all')
    other.setAttribute('content', color)
  }

  const primary = isDark ? pack.preview.primary : pack.preview.primary
  upsertMeta('msapplication-TileColor').setAttribute('content', primary)
  upsertMeta('msapplication-navbutton-color').setAttribute('content', primary)
  upsertMeta('color-scheme').setAttribute('content', mode)
  upsertMeta('apple-mobile-web-app-status-bar-style').setAttribute(
    'content',
    isDark ? 'black-translucent' : 'default',
  )
}

export interface ChromeBootstrapOptions {
  themeStorageKey: string
  modeStorageKey: string
  defaultThemeId: string
  themes: ThemePack[]
  /** Applying `<html data-radius>` before first paint avoids a corner flash. */
  radiusStorageKey?: string
  defaultRadius?: string
}

/** Inline pre-paint script embedded in the root layout (no flash on first paint). */
export function buildChromeBootstrapScript(options: ChromeBootstrapOptions): string {
  const { themeStorageKey, modeStorageKey, defaultThemeId, themes, radiusStorageKey, defaultRadius } = options
  const surfaceLight: Record<string, string> = Object.fromEntries(
    themes.map((t) => [t.id, t.tokens.light['--background'] ?? t.preview.surface]),
  )
  const surfaceDark: Record<string, string> = Object.fromEntries(
    themes.map((t) => [t.id, t.tokens.dark['--background'] ?? t.preview.surface]),
  )
  const primary: Record<string, string> = Object.fromEntries(themes.map((t) => [t.id, t.preview.primary]))

  return `(function(){try{
var sl=${JSON.stringify(surfaceLight)};var sd=${JSON.stringify(surfaceDark)};var p=${JSON.stringify(primary)};
var id=localStorage.getItem(${JSON.stringify(themeStorageKey)})||${JSON.stringify(defaultThemeId)};
var mode=localStorage.getItem(${JSON.stringify(modeStorageKey)})||'light';
var dark=mode==='dark';
var root=document.documentElement;root.setAttribute('data-theme-pack',id);
if(dark)root.classList.add('dark');else root.classList.remove('dark');
${
    radiusStorageKey
      ? `var radius=localStorage.getItem(${JSON.stringify(radiusStorageKey)})||${JSON.stringify(defaultRadius ?? 'square')};root.setAttribute('data-radius',radius==='rounded'?'rounded':'square');`
      : ''
  }
var color=(dark?sd:sl)[id]||(dark?sd:sl)[${JSON.stringify(defaultThemeId)}];
var m=document.head.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.appendChild(m);}m.setAttribute('content',color);m.removeAttribute('media');
var pr=p[id]||p[${JSON.stringify(defaultThemeId)}];var set=function(n,v){var e=document.head.querySelector('meta[name="'+n+'"]');if(!e){e=document.createElement('meta');e.setAttribute('name',n);document.head.appendChild(e);}e.setAttribute('content',v);};set('msapplication-TileColor',pr);set('msapplication-navbutton-color',pr);set('color-scheme',dark?'dark':'light');
}catch(e){}})();`
}
