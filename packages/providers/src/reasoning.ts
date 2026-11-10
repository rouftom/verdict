import {
  REASONING_EFFORTS,
  REASONING_EFFORT_LABELS,
  clampReasoningEffort,
  type ProviderId,
  type ReasoningEffort,
} from '@verdict/shared'

export type { ReasoningEffort }
export { REASONING_EFFORTS, REASONING_EFFORT_LABELS }

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

/** A per-agent override wins; then `REASONING_EFFORT_<PROVIDER>`; then the global fallback. */
export function reasoningEffortFor(provider: ProviderId, override?: ReasoningEffort): string {
  if (override) return override
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
 * Translate a configured effort into the provider's own options. Values the
 * provider does not accept are clamped to the nearest supported level instead
 * of being forwarded and rejected.
 */
export function reasoningProviderOptions(
  provider: ProviderId,
  override?: ReasoningEffort,
  model?: string,
): ReasoningProviderOptions | undefined {
  const raw = reasoningEffortFor(provider, override)
  if (!raw) return undefined
  const value = raw.toLowerCase()

  if (provider === 'anthropic') {
    const budget = asBudget(value)
    if (budget) return { anthropic: { thinking: { type: 'enabled', budgetTokens: budget } } }
    if (value === 'none' || value === 'minimal') return { anthropic: { thinking: { type: 'disabled' } } }
    const effort = asEffort(value)
    const clamped = effort ? clampReasoningEffort(provider, effort, model) : undefined
    return clamped ? { anthropic: { effort: clamped } } : undefined
  }

  if (provider === 'google') {
    const budget = asBudget(value)
    if (budget) return { google: { thinkingConfig: { thinkingBudget: budget } } }
    if (value === 'none') return { google: { thinkingConfig: { thinkingBudget: 0 } } }
    const effort = asEffort(value)
    const clamped = effort ? clampReasoningEffort(provider, effort, model) : undefined
    return clamped ? { google: { thinkingConfig: { thinkingLevel: clamped } } } : undefined
  }

  const effort = asEffort(value)
  if (!effort) return undefined
  const clamped = clampReasoningEffort(provider, effort, model)
  if (!clamped) return undefined

  if (provider === 'xai') return { xai: { reasoningEffort: clamped } }
  if (provider === 'openai') return { openai: { reasoningEffort: clamped } }

  // OpenAI-compatible gateways (Meta, Groq, DeepSeek, Nebius, NVIDIA, Runware,
  // Ollama) all forward `reasoning_effort` under their provider name.
  return { [provider]: { reasoningEffort: clamped } }
}

/**
 * Some models refuse a temperature (Claude 5.5 through the Runware gateway
 * rejects it). The caller omits the field instead of sending a bad request.
 */
export function supportsTemperature(ref: { provider: ProviderId; model: string }): boolean {
  if (ref.provider !== 'runware') return true
  return !/^anthropic[:\-]claude/i.test(ref.model)
}
