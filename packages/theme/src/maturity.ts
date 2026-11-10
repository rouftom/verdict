/**
 * Maturity ramp: one colour per 0–5 class, colour-blind safe.
 *
 * The map, the readiness charts and the exported reports all read this slot, so
 * a class keeps the same colour everywhere (a World requirement, adopted by the
 * existing readiness views at the same time). Viridis-like hues stay legible in
 * both theme modes and in grayscale print.
 */

export const MATURITY_RAMP = [
  '#440154', // 0 · not started
  '#46327e', // 1 · initial
  '#365c8d', // 2 · developing
  '#277f8e', // 3 · established
  '#1fa187', // 4 · advanced
  '#4ac16d', // 5 · leading
] as const

/** The colour of a 0–5 score, rounded and clamped to the ramp. */
export function maturityColor(score: number): string {
  const index = Math.max(0, Math.min(MATURITY_RAMP.length - 1, Math.round(score)))
  return MATURITY_RAMP[index]!
}

/** The class label the ramp is keyed on (same wording as `@sps/readiness`). */
export const MATURITY_CLASSES = ['not-started', 'initial', 'developing', 'established', 'advanced', 'leading'] as const
