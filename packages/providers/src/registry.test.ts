import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  listProviders,
  modelPool,
  resetProviderModelCache,
  rewriteCompletionTokens,
  usesCompletionTokens,
  withCompletionTokens,
} from './registry'

const ENV_KEYS = [
  'MODEL_API_KEY',
  'META_MODELS',
  'META_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_MODELS',
  'OPENAI_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODELS',
  'ANTHROPIC_BASE_URL',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_MODELS',
  'GOOGLE_BASE_URL',
  'XAI_API_KEY',
  'GROK_API_KEY',
  'XAI_MODELS',
  'XAI_BASE_URL',
  'RUNWARE_API_KEY',
  'RUNWARE_MODELS',
  'RUNWARE_BASE_URL',
  'GROQ_API_KEY',
  'GROQ_MODELS',
  'GROQ_BASE_URL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODELS',
  'DEEPSEEK_BASE_URL',
  'NEBIUS_API_KEY',
  'NEBIUS_MODELS',
  'NEBIUS_BASE_URL',
  'NVIDIA_API_KEY',
  'NVIDIA_MODELS',
  'NVIDIA_API_URL',
  'OLLAMA_BASE_URL',
  'OLLAMA_API_KEY',
  'OLLAMA_MODEL',
  'OLLAMA_MODELS',
  'EVAL_MODELS',
  'VERIFIER_MODELS',
  'PROVIDER_MODELS_TTL_SECONDS',
  'PROVIDER_MODELS_ERROR_TTL_SECONDS',
  'PROVIDER_MODELS_TIMEOUT_MS',
]

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

function jsonFetch(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
}

function failingFetch(): typeof fetch {
  return (async () => {
    throw new Error('offline')
  }) as unknown as typeof fetch
}

beforeEach(() => {
  clearEnv()
  resetProviderModelCache()
})

afterEach(() => {
  clearEnv()
  resetProviderModelCache()
})

describe('provider catalog', () => {
  test('reads the model list from the provider API instead of a hardcoded list', async () => {
    process.env.MODEL_API_KEY = 'test-key-not-a-secret'
    process.env.META_BASE_URL = 'https://meta.test/v1'

    const providers = await listProviders({
      force: true,
      fetchImpl: jsonFetch({
        data: [{ id: 'muse-wonder-1.0' }, { id: 'muse-spark-1.3' }, { id: 'muse-image-1.0' }],
      }),
    })
    const meta = providers.find((provider) => provider.id === 'meta')

    expect(meta?.configured).toBe(true)
    expect(meta?.models.map((model) => model.id)).toEqual(['muse-spark-1.3', 'muse-wonder-1.0'])
    expect(meta?.modelsSource).toBe('api')
  })

  test('an Anthropic model released after the code was written appears without a code change', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-a-secret'
    process.env.ANTHROPIC_BASE_URL = 'https://anthropic.test/v1'

    const providers = await listProviders({
      force: true,
      fetchImpl: jsonFetch({
        data: [
          { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' },
          { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' },
        ],
      }),
    })
    const anthropic = providers.find((provider) => provider.id === 'anthropic')
    const haiku = anthropic?.models.find((model) => model.id === 'claude-haiku-5-5')

    expect(haiku).toEqual({
      id: 'claude-haiku-5-5',
      label: 'Claude Haiku 5.5',
      provider: 'anthropic',
      capabilities: { text: true, vision: true, video: false, tools: true, audio: false },
    })
  })

  test('Google keeps generateContent models and strips the models/ prefix', async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key-not-a-secret'
    process.env.GOOGLE_BASE_URL = 'https://google.test/v1beta'

    const providers = await listProviders({
      force: true,
      fetchImpl: jsonFetch({
        models: [
          { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-embedding-001', displayName: 'Gemini Embedding', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    })
    const google = providers.find((provider) => provider.id === 'google')

    expect(google?.models.map((model) => model.id)).toEqual(['gemini-3.5-flash'])
    expect(google?.models[0]?.label).toBe('Gemini 3.5 Flash')
  })

  test('falls back to <PROVIDER>_MODELS only when the model endpoint fails', async () => {
    process.env.MODEL_API_KEY = 'test-key-not-a-secret'
    process.env.META_BASE_URL = 'https://meta.test/v1'
    process.env.META_MODELS = 'muse-wonder-1.0'

    const providers = await listProviders({ force: true, fetchImpl: failingFetch() })
    const meta = providers.find((provider) => provider.id === 'meta')

    expect(meta?.models.map((model) => model.id)).toEqual(['muse-wonder-1.0'])
    expect(meta?.modelsSource).toBe('fallback')
    expect(meta?.modelsError).toBe('The provider model endpoint could not be reached.')
  })

  test('a provider without a key is marked unconfigured and never calls the API', async () => {
    let called = false
    const fetchImpl = (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const providers = await listProviders({ force: true, fetchImpl })
    const meta = providers.find((provider) => provider.id === 'meta')

    expect(meta?.configured).toBe(false)
    expect(meta?.models).toEqual([])
    expect(called).toBe(false)
  })

  test('the default Groq pool comes from the API, not from a baked-in gpt-oss list', async () => {
    process.env.GROQ_API_KEY = 'test-key-not-a-secret'
    process.env.GROQ_BASE_URL = 'https://groq.test/openai/v1'

    const providers = await listProviders({
      force: true,
      fetchImpl: jsonFetch({
        data: [{ id: 'openai/gpt-oss-120b' }, { id: 'whisper-large-v3' }, { id: 'qwen/qwen3.8-27b' }],
      }),
    })
    const groq = providers.find((provider) => provider.id === 'groq')

    expect(groq?.models.map((model) => model.id)).toEqual(['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'])
  })

  test('an explicit evaluator pool keeps only models the provider API returned', async () => {
    process.env.MODEL_API_KEY = 'test-key-not-a-secret'
    process.env.META_BASE_URL = 'https://meta.test/v1'
    process.env.EVAL_MODELS = 'meta:muse-retired-1.0,meta:muse-wonder-1.0'

    const pool = await modelPool('EVAL_MODELS', 2, {
      force: true,
      fetchImpl: jsonFetch({ data: [{ id: 'muse-wonder-1.0' }, { id: 'muse-spark-1.3' }] }),
    })

    expect(pool).toEqual([
      { provider: 'meta', model: 'muse-wonder-1.0' },
      { provider: 'meta', model: 'muse-wonder-1.0' },
    ])
  })

  test('an all-stale explicit pool cycles the discovered catalog', async () => {
    process.env.MODEL_API_KEY = 'test-key-not-a-secret'
    process.env.META_BASE_URL = 'https://meta.test/v1'
    process.env.EVAL_MODELS = 'meta:muse-retired-1.0'

    const pool = await modelPool('EVAL_MODELS', 2, {
      force: true,
      fetchImpl: jsonFetch({ data: [{ id: 'muse-wonder-1.0' }, { id: 'muse-spark-1.3' }] }),
    })

    expect(pool).toEqual([
      { provider: 'meta', model: 'muse-spark-1.3' },
      { provider: 'meta', model: 'muse-wonder-1.0' },
    ])
  })
})

describe('completion token compatibility', () => {
  test('reasoning models are recognised behind a gateway prefix', () => {
    expect(usesCompletionTokens('openai-gpt-6-luna')).toBe(true)
    expect(usesCompletionTokens('openai/gpt-5.1')).toBe(true)
    expect(usesCompletionTokens('gpt-6')).toBe(true)
    expect(usesCompletionTokens('o3-mini')).toBe(true)
    expect(usesCompletionTokens('o4-mini-2025-04-16')).toBe(true)
  })

  test('chat models keep max_tokens', () => {
    expect(usesCompletionTokens('gpt-4o')).toBe(false)
    expect(usesCompletionTokens('openai-gpt-4.1')).toBe(false)
    expect(usesCompletionTokens('deepseek:v4.1@flash-1017')).toBe(false)
    expect(usesCompletionTokens('anthropic-claude-sonnet-5-5')).toBe(false)
  })

  test('rewrites max_tokens only for a reasoning model request', () => {
    const body = JSON.stringify({ model: 'openai-gpt-6-luna', max_tokens: 8192, messages: [] })
    expect(JSON.parse(rewriteCompletionTokens(body))).toEqual({
      model: 'openai-gpt-6-luna',
      max_completion_tokens: 8192,
      messages: [],
    })
  })

  test('keeps an explicit max_completion_tokens and drops max_tokens', () => {
    const body = JSON.stringify({ model: 'openai-gpt-6-luna', max_tokens: 10, max_completion_tokens: 20 })
    expect(JSON.parse(rewriteCompletionTokens(body))).toEqual({
      model: 'openai-gpt-6-luna',
      max_completion_tokens: 20,
    })
  })

  test('leaves other bodies untouched', () => {
    const chat = JSON.stringify({ model: 'openai-gpt-4o', max_tokens: 4096 })
    expect(rewriteCompletionTokens(chat)).toBe(chat)
    const silent = JSON.stringify({ model: 'gpt-6' })
    expect(rewriteCompletionTokens(silent)).toBe(silent)
    expect(rewriteCompletionTokens('not json')).toBe('not json')
    expect(rewriteCompletionTokens('[1,2]')).toBe('[1,2]')
  })

  test('the fetch wrapper rewrites the request before sending it', async () => {
    let sent: unknown
    const fake = (async (_input: unknown, init?: RequestInit) => {
      sent = init?.body
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const wrapped = withCompletionTokens(fake)
    await wrapped('https://runware.test/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'openai-gpt-6-luna', max_tokens: 64 }),
    })

    expect(JSON.parse(String(sent))).toEqual({ model: 'openai-gpt-6-luna', max_completion_tokens: 64 })
  })
})
