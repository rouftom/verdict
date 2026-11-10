import { afterEach, describe, expect, test } from 'bun:test'
import { reasoningEffortFor, reasoningProviderOptions, supportsTemperature } from './reasoning'
import { reasoningEffortsFor } from '@verdict/shared'

const ENV_KEYS = ['REASONING_EFFORT', 'REASONING_EFFORT_ANTHROPIC', 'REASONING_EFFORT_GOOGLE', 'REASONING_EFFORT_GROQ']

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key]
}

afterEach(clearEnv)

describe('reasoning mapping', () => {
  test('a per-agent override wins over the environment', () => {
    process.env.REASONING_EFFORT_ANTHROPIC = 'medium'
    expect(reasoningEffortFor('anthropic', 'high')).toBe('high')
    expect(reasoningProviderOptions('anthropic', 'high')).toEqual({ anthropic: { effort: 'high' } })
    expect(reasoningProviderOptions('anthropic')).toEqual({ anthropic: { effort: 'medium' } })
  })

  test('none disables Anthropic thinking', () => {
    expect(reasoningProviderOptions('anthropic', 'none')).toEqual({ anthropic: { thinking: { type: 'disabled' } } })
  })

  test('Google xhigh and max collapse to high', () => {
    expect(reasoningProviderOptions('google', 'xhigh')).toEqual({ google: { thinkingConfig: { thinkingLevel: 'high' } } })
    expect(reasoningProviderOptions('google', 'max')).toEqual({ google: { thinkingConfig: { thinkingLevel: 'high' } } })
    expect(reasoningProviderOptions('google', 'minimal')).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'minimal' } },
    })
  })

  test('OpenAI-compatible gateways forward reasoning_effort', () => {
    expect(reasoningProviderOptions('runware', 'low', 'deepseek:v4.1@flash-1017')).toEqual({
      runware: { reasoningEffort: 'low' },
    })
    expect(reasoningProviderOptions('runware', 'max', 'deepseek:v4.1@flash-1017')).toEqual({
      runware: { reasoningEffort: 'max' },
    })
  })

  test('unsupported levels clamp to the nearest accepted one', () => {
    expect(reasoningProviderOptions('groq', 'none', 'openai/gpt-oss-20b')).toEqual({
      groq: { reasoningEffort: 'low' },
    })
    expect(reasoningProviderOptions('groq', 'xhigh', 'openai/gpt-oss-20b')).toEqual({
      groq: { reasoningEffort: 'high' },
    })
    expect(reasoningProviderOptions('xai', 'max')).toEqual({ xai: { reasoningEffort: 'xhigh' } })
    expect(reasoningProviderOptions('xai', 'minimal')).toEqual({ xai: { reasoningEffort: 'low' } })
  })

  test('Runware clamps per model family', () => {
    expect(reasoningProviderOptions('runware', 'none', 'xai:grok@4.7')).toEqual({
      runware: { reasoningEffort: 'low' },
    })
    expect(reasoningProviderOptions('runware', 'max', 'xai:grok@4.7')).toEqual({
      runware: { reasoningEffort: 'xhigh' },
    })
    expect(reasoningProviderOptions('runware', 'minimal', 'google:gemini@4-argon')).toEqual({
      runware: { reasoningEffort: 'low' },
    })
    expect(reasoningProviderOptions('runware', 'none', 'anthropic:claude@sonnet-5.5')).toEqual({
      runware: { reasoningEffort: 'none' },
    })
  })

  test('the UI list follows the provider and the Runware family', () => {
    expect(reasoningEffortsFor('groq')).toEqual(['low', 'medium', 'high'])
    expect(reasoningEffortsFor('google')).toEqual(['none', 'minimal', 'low', 'medium', 'high'])
    expect(reasoningEffortsFor('runware', 'xai:grok@4.7')).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(reasoningEffortsFor('runware', 'anthropic:claude@opus-5.5')).toContain('max')
  })

  test('an unknown env value is ignored', () => {
    process.env.REASONING_EFFORT = 'turbo'
    expect(reasoningProviderOptions('anthropic')).toBeUndefined()
  })

  test('a numeric env value is a thinking budget', () => {
    process.env.REASONING_EFFORT_ANTHROPIC = '4096'
    expect(reasoningProviderOptions('anthropic')).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 4096 } },
    })
  })
})

describe('temperature policy', () => {
  test('Claude models reached through Runware reject temperature', () => {
    expect(supportsTemperature({ provider: 'runware', model: 'anthropic:claude@sonnet-5.5' })).toBe(false)
    expect(supportsTemperature({ provider: 'runware', model: 'anthropic-claude-sonnet-5-5' })).toBe(false)
    expect(supportsTemperature({ provider: 'runware', model: 'deepseek:v4.1@flash-1017' })).toBe(true)
    expect(supportsTemperature({ provider: 'anthropic', model: 'claude-sonnet-5-5' })).toBe(true)
  })
})
