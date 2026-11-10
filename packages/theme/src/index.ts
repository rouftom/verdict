/**
 * @sps/theme · the SarkiAI admin charter (apps/organization) replicated for the
 * Policy Sandbox. Theme packs: meta (default, Meta blue), fada, green, ocean,
 * sunset, mono.
 */

import meta from './packs/meta.json'
import fada from './packs/fada.json'
import green from './packs/green.json'
import ocean from './packs/ocean.json'
import sunset from './packs/sunset.json'
import mono from './packs/mono.json'
import type { ThemePack } from './types'

const rawPacks: ThemePack[] = [meta, fada, green, ocean, sunset, mono] as ThemePack[]

export const THEME_PACKS: ThemePack[] = rawPacks

const defaultPack = THEME_PACKS.find((pack) => pack.isDefault) ?? THEME_PACKS[0]!
export const DEFAULT_THEME_PACK_ID = defaultPack.id
export const THEME_PACK_IDS = THEME_PACKS.map((pack) => pack.id)

export function getThemePack(id?: string | null): ThemePack {
  return (id && THEME_PACKS.find((pack) => pack.id === id)) || defaultPack
}

export function isThemePackId(id?: string | null): boolean {
  return !!id && THEME_PACK_IDS.includes(id)
}

export const THEME_PACK_STORAGE_KEY = 'sps-theme-pack'
export const MODE_STORAGE_KEY = 'sps-theme-mode'

/** Corner treatment of the console chrome: square by default, or the FSM radii. */
export type CornerStyle = 'square' | 'rounded'
export const DEFAULT_CORNER_STYLE: CornerStyle = 'square'
export const RADIUS_STORAGE_KEY = 'sps.radius'

export function resolveCornerStyle(preferred?: string | null): CornerStyle {
  return preferred === 'rounded' ? 'rounded' : DEFAULT_CORNER_STYLE
}

export * from './types'
export * from './maturity'
export * from './generate-css'
export * from './chrome'
