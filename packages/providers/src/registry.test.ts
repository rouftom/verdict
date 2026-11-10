import { afterEach, describe, expect, test } from 'bun:test'
import { listProviders } from './registry'

const ENV_KEYS = ['MODEL_API_KEY', 'META_MODELS', 'META_REASONING_MODEL', 'META_VISION_MODEL']

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('provider catalog', () => {
  test('Meta always offers Muse Wonder, even when META_MODELS omits it', () => {
    process.env.MODEL_API_KEY = 'test-key-not-a-secret'
    process.env.META_MODELS = 'muse-spark-1.3'
    const meta = listProviders().find((provider) => provider.id === 'meta')
    expect(meta?.configured).toBe(true)
    expect(meta?.models.map((model) => model.id)).toEqual(['muse-spark-1.3', 'muse-wonder-1.0'])
  })

  test('a provider without a key is marked unconfigured', () => {
    delete process.env.MODEL_API_KEY
    const meta = listProviders().find((provider) => provider.id === 'meta')
    expect(meta?.configured).toBe(false)
  })
})
