/**
 * The arena rail sits at the bottom of the stage. Its height is user owned:
 * a drag sets it, the viewport caps it, and the children fill whatever is left.
 */
export const RAIL_MIN_HEIGHT = 150
export const RAIL_MAX_HEIGHT = 480
export const RAIL_DEFAULT_HEIGHT = 208
export const RAIL_STORAGE_KEY = 'verdict.arena.railHeight'

/** Keep a dragged or restored height inside the usable band for this viewport. */
export function clampRailHeight(value: number, viewportHeight = 900): number {
  const ceiling = Math.min(RAIL_MAX_HEIGHT, Math.max(RAIL_MIN_HEIGHT, Math.round(viewportHeight * 0.6)))
  if (!Number.isFinite(value)) return Math.min(RAIL_DEFAULT_HEIGHT, ceiling)
  return Math.min(ceiling, Math.max(RAIL_MIN_HEIGHT, Math.round(value)))
}
