import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createXai } from '@ai-sdk/xai'
import type { LanguageModel } from 'ai'
import type { ModelCapabilities, ModelOption, ModelRef, ProviderId, ProviderInfo } from '@verdict/shared'

const DESCRIPTIONS: Record<ProviderId, string> = {
  meta: 'Meta Model API',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  xai: 'xAI Grok',
  runware: 'Runware',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  nebius: 'Nebius',
  nvidia: 'NVIDIA NIM',
  ollama: 'Ollama (local)',
}

const CAPABILITIES: Record<ProviderId, ModelCapabilities> = {
  meta: { text: true, vision: true, video: false, tools: true, audio: false },
  openai: { text: true, vision: true, video: false, tools: true, audio: false },
  anthropic: { text: true, vision: true, video: false, tools: true, audio: false },
  google: { text: true, vision: true, video: true, tools: true, audio: true },
  xai: { text: true, vision: true, video: false, tools: true, audio: false },
  runware: { text: true, vision: true, video: true, tools: false, audio: true },
  groq: { text: true, vision: false, video: false, tools: true, audio: true },
  deepseek: { text: true, vision: false, video: false, tools: true, audio: false },
  nebius: { text: true, vision: true, video: false, tools: true, audio: false },
  nvidia: { text: true, vision: true, video: false, tools: true, audio: false },
  ollama: { text: true, vision: false, video: false, tools: true, audio: false },
}

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = env(name)
    if (value) return value
  }
  return ''
}

/** Keep the first entry per model id: two env vars often point at the same model. */
function dedupeModels(models: ModelOption[]): ModelOption[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
}

function parseModels(value: string, provider: ProviderId, fallback: string[]): ModelOption[] {
  const raw = value.trim()
  if (!raw) {
    return dedupeModels(
      fallback.filter(Boolean).map((id) => ({ id, label: id, provider, capabilities: { ...CAPABILITIES[provider] } })),
    )
  }

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return dedupeModels(
          parsed
          .map((entry) => {
            if (typeof entry === 'string') return { id: entry, label: entry, provider, capabilities: { ...CAPABILITIES[provider] } }
            if (entry && typeof entry === 'object') {
              const source = entry as Record<string, unknown>
              const id = String(source.id ?? source.model ?? '').trim()
              if (!id) return null
              return {
                id,
                label: String(source.label ?? id),
                provider,
                capabilities: { ...CAPABILITIES[provider], ...(source.capabilities as Partial<ModelCapabilities> | undefined) },
              } satisfies ModelOption
            }
            return null
          })
          .filter((entry): entry is ModelOption => entry !== null),
        )
      }
    } catch {
      /* fall through to the comma list */
    }
  }

  return dedupeModels(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => ({ id, label: id, provider, capabilities: { ...CAPABILITIES[provider] } })),
  )
}

function withV1(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, '')
  return base.endsWith('/v1') ? base : `${base}/v1`
}

/** Always offer a model, even when the operator's `<PROVIDER>_MODELS` list omits it. */
function withModel(models: ModelOption[], provider: ProviderId, id: string): ModelOption[] {
  if (models.some((model) => model.id === id)) return models
  return [...models, { id, label: id, provider, capabilities: { ...CAPABILITIES[provider] } }]
}

/** Describe every provider, including the ones that are not configured. Never returns a key. */
export function listProviders(): ProviderInfo[] {
  const metaKey = env('MODEL_API_KEY')
  const openaiKey = env('OPENAI_API_KEY')
  const anthropicKey = env('ANTHROPIC_API_KEY')
  const googleKey = firstEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY')
  const xaiKey = firstEnv('XAI_API_KEY', 'GROK_API_KEY')
  const runwareKey = env('RUNWARE_API_KEY')
  const groqKey = env('GROQ_API_KEY')
  const deepseekKey = env('DEEPSEEK_API_KEY')
  const nebiusKey = env('NEBIUS_API_KEY')
  const nvidiaKey = env('NVIDIA_API_KEY')
  const ollamaURL = env('OLLAMA_BASE_URL')

  const providers: ProviderInfo[] = [
    {
      id: 'meta',
      label: DESCRIPTIONS.meta,
      configured: Boolean(metaKey),
      baseURL: withV1(env('META_BASE_URL') || 'https://api.meta.ai/v1'),
      models: withModel(
        parseModels(env('META_MODELS'), 'meta', [
          env('META_REASONING_MODEL') || 'muse-spark-1.3',
          env('META_VISION_MODEL'),
        ].filter(Boolean)),
        'meta',
        'muse-wonder-1.0',
      ),
    },
    {
      id: 'openai',
      label: DESCRIPTIONS.openai,
      configured: Boolean(openaiKey),
      baseURL: withV1(env('OPENAI_BASE_URL') || 'https://api.openai.com/v1'),
      models: parseModels(env('OPENAI_MODELS'), 'openai', ['gpt-4o', 'gpt-4o-mini']),
    },
    {
      id: 'anthropic',
      label: DESCRIPTIONS.anthropic,
      configured: Boolean(anthropicKey),
      models: parseModels(env('ANTHROPIC_MODELS'), 'anthropic', ['claude-sonnet-5-5', 'claude-opus-5-5']),
    },
    {
      id: 'google',
      label: DESCRIPTIONS.google,
      configured: Boolean(googleKey),
      models: parseModels(env('GOOGLE_MODELS'), 'google', [
        'gemini-3.5-flash',
        'gemini-3.1-flash-lite',
        'gemini-3.1-pro-preview',
      ]),
    },
    {
      id: 'xai',
      label: DESCRIPTIONS.xai,
      configured: Boolean(xaiKey),
      baseURL: withV1(env('XAI_BASE_URL') || 'https://api.x.ai/v1'),
      models: parseModels(env('XAI_MODELS') || env('GROK_MODELS'), 'xai', ['grok-4', 'grok-3-mini']),
    },
    {
      id: 'runware',
      label: DESCRIPTIONS.runware,
      configured: Boolean(runwareKey),
      baseURL: withV1(env('RUNWARE_BASE_URL') || 'https://api.runware.ai/v1'),
      models: parseModels(env('RUNWARE_MODELS'), 'runware', [
        'google:gemini@4-argon',
        'deepseek:v4.1@flash-1017',
        'xai:grok@4.7',
        'moonshotai:kimi@k3.1-pro',
        'zai:glm@5.3',
        'minimax:m3.1@flash',
      ]),
    },
    {
      id: 'groq',
      label: DESCRIPTIONS.groq,
      configured: Boolean(groqKey),
      baseURL: withV1(env('GROQ_BASE_URL') || 'https://api.groq.com/openai/v1'),
      models: parseModels(env('GROQ_MODELS'), 'groq', [
        'openai/gpt-oss-120b',
        'qwen/qwen3.8-27b',
        'qwen/qwen3.6-27b',
      ]),
    },
    {
      id: 'deepseek',
      label: DESCRIPTIONS.deepseek,
      configured: Boolean(deepseekKey),
      baseURL: withV1(env('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com/v1'),
      models: parseModels(env('DEEPSEEK_MODELS'), 'deepseek', ['deepseek-chat', 'deepseek-reasoner']),
    },
    {
      id: 'nebius',
      label: DESCRIPTIONS.nebius,
      configured: Boolean(nebiusKey),
      baseURL: withV1(env('NEBIUS_BASE_URL') || 'https://api.studio.nebius.ai/v1'),
      models: parseModels(env('NEBIUS_MODELS'), 'nebius', [
        'deepseek-ai/DeepSeek-V3',
        'meta-llama/Llama-3.3-70B-Instruct',
      ]),
    },
    {
      id: 'nvidia',
      label: DESCRIPTIONS.nvidia,
      configured: Boolean(nvidiaKey),
      baseURL: withV1(env('NVIDIA_API_URL') || 'https://integrate.api.nvidia.com/v1'),
      models: parseModels(env('NVIDIA_MODELS'), 'nvidia', [
        'nvidia/nemotron-3-ultra-550b-a55b',
        'nvidia/nemotron-3.5-super-vl-120b-a12b',
        'nvidia/nemotron-3.5-bolt-e4b',
      ]),
    },
    {
      id: 'ollama',
      label: DESCRIPTIONS.ollama,
      configured: Boolean(ollamaURL || env('OLLAMA_MODEL')),
      baseURL: withV1(ollamaURL || 'http://localhost:11434'),
      models: parseModels(env('OLLAMA_MODELS'), 'ollama', [env('OLLAMA_MODEL') || 'muse-glimmer']),
    },
  ]

  return providers
}

export function configuredModels(): ModelOption[] {
  return listProviders().filter((provider) => provider.configured).flatMap((provider) => provider.models)
}

export function modelRefKey(ref: ModelRef): string {
  return `${ref.provider}:${ref.model}`
}

export function parseModelRef(value: string): ModelRef | null {
  const trimmed = value.trim()
  const separator = trimmed.indexOf(':')
  if (separator <= 0) return null
  const provider = trimmed.slice(0, separator) as ProviderId
  const model = trimmed.slice(separator + 1).trim()
  if (!DESCRIPTIONS[provider] || !model) return null
  return { provider, model }
}

/** Read `EVAL_MODELS` / `VERIFIER_MODELS`, cycling the list to the required size. */
export function modelPool(envName: 'EVAL_MODELS' | 'VERIFIER_MODELS', size: number): ModelRef[] {
  const raw = env(envName)
  const parsed = raw
    .split(',')
    .map((entry) => parseModelRef(entry))
    .filter((entry): entry is ModelRef => entry !== null)

  const available = parsed.length > 0 ? parsed : configuredModels().map((model) => ({ provider: model.provider, model: model.id }))
  if (available.length === 0) return []
  return Array.from({ length: size }, (_, index) => available[index % available.length]!)
}

export function createLanguageModel(ref: ModelRef): LanguageModel {
  const provider = listProviders().find((entry) => entry.id === ref.provider)
  if (!provider) throw new Error(`Unknown provider "${ref.provider}".`)
  if (!provider.configured) throw new Error(`Provider "${ref.provider}" is not configured.`)

  switch (ref.provider) {
    case 'meta': {
      const client = createOpenAICompatible({
        name: 'meta',
        baseURL: provider.baseURL ?? 'https://api.meta.ai/v1',
        apiKey: env('MODEL_API_KEY'),
      })
      return client(ref.model)
    }
    case 'runware': {
      const client = createOpenAICompatible({
        name: 'runware',
        baseURL: provider.baseURL ?? 'https://api.runware.ai/v1',
        apiKey: env('RUNWARE_API_KEY'),
      })
      return client(ref.model)
    }
    case 'groq': {
      const client = createOpenAICompatible({
        name: 'groq',
        baseURL: provider.baseURL ?? 'https://api.groq.com/openai/v1',
        apiKey: env('GROQ_API_KEY'),
      })
      return client(ref.model)
    }
    case 'deepseek': {
      const client = createOpenAICompatible({
        name: 'deepseek',
        baseURL: provider.baseURL ?? 'https://api.deepseek.com/v1',
        apiKey: env('DEEPSEEK_API_KEY'),
      })
      return client(ref.model)
    }
    case 'nebius': {
      const client = createOpenAICompatible({
        name: 'nebius',
        baseURL: provider.baseURL ?? 'https://api.studio.nebius.ai/v1',
        apiKey: env('NEBIUS_API_KEY'),
      })
      return client(ref.model)
    }
    case 'nvidia': {
      const client = createOpenAICompatible({
        name: 'nvidia',
        baseURL: provider.baseURL ?? 'https://integrate.api.nvidia.com/v1',
        apiKey: env('NVIDIA_API_KEY'),
      })
      return client(ref.model)
    }
    case 'ollama': {
      const client = createOpenAICompatible({
        name: 'ollama',
        baseURL: provider.baseURL ?? 'http://localhost:11434/v1',
        apiKey: env('OLLAMA_API_KEY') || 'ollama',
      })
      return client(ref.model)
    }
    case 'openai': {
      const client = createOpenAI({
        apiKey: env('OPENAI_API_KEY'),
        ...(env('OPENAI_BASE_URL') ? { baseURL: withV1(env('OPENAI_BASE_URL')) } : {}),
      })
      return client(ref.model)
    }
    case 'anthropic': {
      const client = createAnthropic({
        apiKey: env('ANTHROPIC_API_KEY'),
        ...(env('ANTHROPIC_BASE_URL') ? { baseURL: withV1(env('ANTHROPIC_BASE_URL')) } : {}),
      })
      return client(ref.model)
    }
    case 'google': {
      const client = createGoogleGenerativeAI({
        apiKey: firstEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'),
        ...(env('GOOGLE_BASE_URL') ? { baseURL: env('GOOGLE_BASE_URL') } : {}),
      })
      return client(ref.model)
    }
    case 'xai': {
      const client = createXai({
        apiKey: firstEnv('XAI_API_KEY', 'GROK_API_KEY'),
        ...(env('XAI_BASE_URL') ? { baseURL: withV1(env('XAI_BASE_URL')) } : {}),
      })
      return client(ref.model)
    }
  }
}

export function providerLabel(provider: ProviderId): string {
  return DESCRIPTIONS[provider] ?? provider
}

export type { ModelCapabilities, ModelOption, ModelRef, ProviderId, ProviderInfo }
