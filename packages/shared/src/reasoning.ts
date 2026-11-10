import type { ProviderId, ReasoningEffort } from './types'

/** Canonical order for the UI and the env parser (lowest to highest). */
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

const EVERY_EFFORT = REASONING_EFFORTS
const LOW_TO_HIGH: readonly ReasoningEffort[] = ['low', 'medium', 'high']
const LOW_TO_XHIGH: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh']

/**
 * What each direct provider actually accepts. Anything outside the list is
 * clamped to the nearest supported level before it reaches the API.
 */
const BY_PROVIDER: Record<ProviderId, readonly ReasoningEffort[]> = {
  meta: LOW_TO_HIGH,
  openai: EVERY_EFFORT,
  anthropic: EVERY_EFFORT,
  // thinkingLevel is minimal…high; `none` is sent as a zero thinking budget.
  google: ['none', 'minimal', 'low', 'medium', 'high'],
  xai: ['none', 'low', 'medium', 'high', 'xhigh'],
  runware: EVERY_EFFORT,
  groq: LOW_TO_HIGH,
  deepseek: LOW_TO_HIGH,
  nebius: LOW_TO_HIGH,
  nvidia: EVERY_EFFORT,
  ollama: LOW_TO_HIGH,
}

/**
 * Runware is one gateway in front of several model families, and the accepted
 * effort range depends on the family behind the AIR id.
 */
const RUNWARE_BY_FAMILY: Record<string, readonly ReasoningEffort[]> = {
  anthropic: EVERY_EFFORT,
  deepseek: EVERY_EFFORT,
  xai: LOW_TO_XHIGH,
  google: ['none', 'low', 'medium', 'high'],
  minimax: LOW_TO_HIGH,
  moonshotai: LOW_TO_HIGH,
  zai: LOW_TO_HIGH,
}

/** Effort levels the UI may offer for a given provider (and Runware model). */
export function reasoningEffortsFor(provider: ProviderId, model?: string): readonly ReasoningEffort[] {
  if (provider === 'runware' && model) {
    const family = model.split(':')[0]?.trim().toLowerCase() ?? ''
    return RUNWARE_BY_FAMILY[family] ?? LOW_TO_HIGH
  }
  return BY_PROVIDER[provider]
}

/**
 * Snap an unsupported level to the closest supported one. `none` on a
 * low…high provider becomes `low`; `max` becomes `high`.
 */
export function clampReasoningEffort(
  provider: ProviderId,
  effort: ReasoningEffort,
  model?: string,
): ReasoningEffort | undefined {
  const allowed = reasoningEffortsFor(provider, model)
  if (allowed.includes(effort)) return effort
  const target = REASONING_EFFORTS.indexOf(effort)
  if (target < 0) return undefined
  let best: ReasoningEffort | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of allowed) {
    const distance = Math.abs(REASONING_EFFORTS.indexOf(candidate) - target)
    // On a tie prefer the higher level: `minimal` is closer to `low` than to
    // `none` when a provider only offers `none` and `low…high`.
    if (distance <= bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}
