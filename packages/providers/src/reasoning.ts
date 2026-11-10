import type { ProviderId } from '@verdict/shared'

/**
 * Provider-neutral reasoning effort. Each provider maps it to its own knob:
 * Anthropic `effort` (or a thinking budget), Google `thinkingLevel`, OpenAI and
 * OpenAI-compatible gateways `reasoning_effort`.
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const REASONING_EFFORTS: ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

/** Shape accepted by the AI SDK `providerOptions` field. */
type ReasoningValue = string | number | boolean | ReasoningValue[] | { [key: string]: ReasoningValue }
export type ReasoningProviderOptions = Record<string, Record<string, ReasoningValue>>

const PROVIDER_NAMES: Record<ProviderId, string> = {
  meta: 'META',
  openai: 'OPENAI',
  anthropic: 'ANTHROPIC',
  google: 'GOOGLE',
  xai: 'XAI',
  runware: 'RUNWARE',
  groq: 'GROQ',
  deepseek: 'DEEPSEEK',
  nebius: 'NEBIUS',
  nvidia: 'NVIDIA',
  ollama: 'OLLAMA',
}

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

/** `REASONING_EFFORT_<PROVIDER>` wins; `REASONING_EFFORT` is the fallback. */
export function reasoningEffortFor(provider: ProviderId): string {
  return env(`REASONING_EFFORT_${PROVIDER_NAMES[provider]}`) || env('REASONING_EFFORT')
}

function asEffort(value: string): ReasoningEffort | undefined {
  return REASONING_EFFORTS.find((effort) => effort === value.toLowerCase())
}

function asBudget(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const budget = Number(value)
  return Number.isFinite(budget) && budget > 0 ? budget : undefined
}

/**
 * Translate the configured effort into the provider's own options. Unknown
 * values are ignored rather than sent to an API that would reject them.
 */
export function reasoningProviderOptions(provider: ProviderId): ReasoningProviderOptions | undefined {
  const raw = reasoningEffortFor(provider)
  if (!raw) return undefined
  const value = raw.toLowerCase()

  if (provider === 'anthropic') {
    const budget = asBudget(value)
    if (budget) return { anthropic: { thinking: { type: 'enabled', budgetTokens: budget } } }
    if (value === 'none' || value === 'minimal') return { anthropic: { thinking: { type: 'disabled' } } }
    const effort = asEffort(value)
    if (!effort) return undefined
    return { anthropic: { effort } }
  }

  if (provider === 'google') {
    const budget = asBudget(value)
    if (budget) return { google: { thinkingConfig: { thinkingBudget: budget } } }
    if (value === 'none') return { google: { thinkingConfig: { thinkingBudget: 0 } } }
    if (value === 'xhigh' || value === 'max') return { google: { thinkingConfig: { thinkingLevel: 'high' } } }
    const effort = asEffort(value)
    if (!effort || effort === 'xhigh' || effort === 'max') return undefined
    return { google: { thinkingConfig: { thinkingLevel: effort } } }
  }

  if (provider === 'xai') {
    const effort = asEffort(value)
    if (!effort) return undefined
    const mapped = effort === 'minimal' ? 'low' : effort === 'max' ? 'xhigh' : effort
    return { xai: { reasoningEffort: mapped } }
  }

  if (provider === 'openai') {
    const effort = asEffort(value)
    return effort ? { openai: { reasoningEffort: effort } } : undefined
  }

  // OpenAI-compatible gateways (Meta, Groq, DeepSeek, Nebius, NVIDIA, Runware,
  // Ollama) all forward `reasoning_effort` under their provider name.
  const effort = asEffort(value)
  return effort ? { [provider]: { reasoningEffort: effort } } : undefined
}

/**
 * Some models refuse a temperature (Claude 5.5 through the Runware gateway
 * rejects it). The caller omits the field instead of sending a bad request.
 */
export function supportsTemperature(ref: { provider: ProviderId; model: string }): boolean {
  if (ref.provider !== 'runware') return true
  return !/^anthropic[:\-]claude/i.test(ref.model)
}
