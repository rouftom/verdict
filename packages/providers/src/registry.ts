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

type Discovery = 'openai' | 'anthropic' | 'google' | 'ollama'

interface ProviderDefinition {
  id: ProviderId
  label: string
  configured: boolean
  baseURL?: string
  apiKey: string
  discovery: Discovery
  /** Only used when the provider model endpoint cannot be reached. */
  fallback: string
}

interface CachedModels {
  models: ModelOption[]
  fetchedAt: number
  source?: 'api' | 'fallback'
  error?: string
}

export interface ProviderCatalogOptions {
  /** Bypass the in-memory cache, for an explicit refresh. */
  force?: boolean
  /** Injectable for tests; defaults to the runtime `fetch`. */
  fetchImpl?: typeof fetch
}

/** Chat models only: embeddings, speech, images, video and rerankers cannot evaluate a project. */
const NON_CHAT_MODEL =
  /(?:^|[\s/_:@.-])(embed|embedding|embedder|rerank|reranker|whisper|transcribe|transcription|speech|tts|audio|realtime|moderation|dall-e|image|imagen|veo|video|upscale|guard|safety|orpheus|sam|clip)(?=$|[\s/_:@.-])/i

const modelCache = new Map<ProviderId, CachedModels>()
const inFlight = new Map<ProviderId, Promise<CachedModels>>()

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

function withV1(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, '')
  return base.endsWith('/v1') ? base : `${base}/v1`
}

function cacheTtlMs(): number {
  const seconds = Number(env('PROVIDER_MODELS_TTL_SECONDS') || 600)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 600_000
}

function errorTtlMs(): number {
  const seconds = Number(env('PROVIDER_MODELS_ERROR_TTL_SECONDS') || 60)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000
}

function discoveryTimeoutMs(): number {
  const milliseconds = Number(env('PROVIDER_MODELS_TIMEOUT_MS') || 6000)
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 6000
}

/** Keep the first entry per model id. */
function dedupeModels(models: ModelOption[]): ModelOption[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
}

/** Parse a `<PROVIDER>_MODELS` fallback: a comma list or a JSON array. */
function parseFallback(value: string, provider: ProviderId): ModelOption[] {
  const raw = value.trim()
  if (!raw) return []

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

/** Every provider, its key and the endpoint its model catalog lives on. Never leaves this module with a key. */
function definitions(): ProviderDefinition[] {
  return [
    {
      id: 'meta',
      label: DESCRIPTIONS.meta,
      configured: Boolean(env('MODEL_API_KEY')),
      baseURL: withV1(env('META_BASE_URL') || 'https://api.meta.ai/v1'),
      apiKey: env('MODEL_API_KEY'),
      discovery: 'openai',
      fallback: env('META_MODELS'),
    },
    {
      id: 'openai',
      label: DESCRIPTIONS.openai,
      configured: Boolean(env('OPENAI_API_KEY')),
      baseURL: withV1(env('OPENAI_BASE_URL') || 'https://api.openai.com/v1'),
      apiKey: env('OPENAI_API_KEY'),
      discovery: 'openai',
      fallback: env('OPENAI_MODELS'),
    },
    {
      id: 'anthropic',
      label: DESCRIPTIONS.anthropic,
      configured: Boolean(env('ANTHROPIC_API_KEY')),
      baseURL: withV1(env('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com/v1'),
      apiKey: env('ANTHROPIC_API_KEY'),
      discovery: 'anthropic',
      fallback: env('ANTHROPIC_MODELS'),
    },
    {
      id: 'google',
      label: DESCRIPTIONS.google,
      configured: Boolean(firstEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY')),
      baseURL: (env('GOOGLE_BASE_URL') || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
      apiKey: firstEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'),
      discovery: 'google',
      fallback: env('GOOGLE_MODELS'),
    },
    {
      id: 'xai',
      label: DESCRIPTIONS.xai,
      configured: Boolean(firstEnv('XAI_API_KEY', 'GROK_API_KEY')),
      baseURL: withV1(env('XAI_BASE_URL') || 'https://api.x.ai/v1'),
      apiKey: firstEnv('XAI_API_KEY', 'GROK_API_KEY'),
      discovery: 'openai',
      fallback: env('XAI_MODELS') || env('GROK_MODELS'),
    },
    {
      id: 'runware',
      label: DESCRIPTIONS.runware,
      configured: Boolean(env('RUNWARE_API_KEY')),
      baseURL: withV1(env('RUNWARE_BASE_URL') || 'https://api.runware.ai/v1'),
      apiKey: env('RUNWARE_API_KEY'),
      discovery: 'openai',
      fallback: env('RUNWARE_MODELS'),
    },
    {
      id: 'groq',
      label: DESCRIPTIONS.groq,
      configured: Boolean(env('GROQ_API_KEY')),
      baseURL: withV1(env('GROQ_BASE_URL') || 'https://api.groq.com/openai/v1'),
      apiKey: env('GROQ_API_KEY'),
      discovery: 'openai',
      fallback: env('GROQ_MODELS'),
    },
    {
      id: 'deepseek',
      label: DESCRIPTIONS.deepseek,
      configured: Boolean(env('DEEPSEEK_API_KEY')),
      baseURL: withV1(env('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com/v1'),
      apiKey: env('DEEPSEEK_API_KEY'),
      discovery: 'openai',
      fallback: env('DEEPSEEK_MODELS'),
    },
    {
      id: 'nebius',
      label: DESCRIPTIONS.nebius,
      configured: Boolean(env('NEBIUS_API_KEY')),
      baseURL: withV1(env('NEBIUS_BASE_URL') || 'https://api.studio.nebius.ai/v1'),
      apiKey: env('NEBIUS_API_KEY'),
      discovery: 'openai',
      fallback: env('NEBIUS_MODELS'),
    },
    {
      id: 'nvidia',
      label: DESCRIPTIONS.nvidia,
      configured: Boolean(env('NVIDIA_API_KEY')),
      baseURL: withV1(env('NVIDIA_API_URL') || 'https://integrate.api.nvidia.com/v1'),
      apiKey: env('NVIDIA_API_KEY'),
      discovery: 'openai',
      fallback: env('NVIDIA_MODELS'),
    },
    {
      id: 'ollama',
      label: DESCRIPTIONS.ollama,
      configured: Boolean(env('OLLAMA_BASE_URL') || env('OLLAMA_MODEL')),
      baseURL: (env('OLLAMA_BASE_URL') || 'http://localhost:11434').replace(/\/+$/, ''),
      apiKey: env('OLLAMA_API_KEY') || 'ollama',
      discovery: 'ollama',
      fallback: env('OLLAMA_MODELS') || env('OLLAMA_MODEL'),
    },
  ]
}

function modelEndpoint(definition: ProviderDefinition): { url: string; headers: Record<string, string> } {
  const base = (definition.baseURL ?? '').replace(/\/+$/, '')
  if (definition.discovery === 'google') {
    return {
      // The key travels in the query string; never log this URL.
      url: `${base}/models?pageSize=1000&key=${encodeURIComponent(definition.apiKey)}`,
      headers: { accept: 'application/json' },
    }
  }
  if (definition.discovery === 'ollama') {
    return {
      url: `${base.replace(/\/v1$/, '')}/api/tags`,
      headers: definition.apiKey ? { authorization: `Bearer ${definition.apiKey}` } : {},
    }
  }
  if (definition.discovery === 'anthropic') {
    return {
      url: `${base}/models?limit=1000`,
      headers: { 'x-api-key': definition.apiKey, 'anthropic-version': '2023-06-01', accept: 'application/json' },
    }
  }
  return {
    url: `${base}/models`,
    headers: { authorization: `Bearer ${definition.apiKey}`, accept: 'application/json' },
  }
}

function parseProviderModels(definition: ProviderDefinition, body: unknown): ModelOption[] {
  const source = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  let entries: unknown[] = []

  if (definition.discovery === 'google') {
    entries = Array.isArray(source.models) ? source.models : []
    entries = entries.filter((entry) => {
      const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
      const methods = Array.isArray(record.supportedGenerationMethods) ? record.supportedGenerationMethods.map(String) : []
      return methods.length === 0 || methods.includes('generateContent')
    })
  } else if (definition.discovery === 'ollama') {
    entries = Array.isArray(source.models) ? source.models : []
  } else {
    entries = Array.isArray(source.data) ? source.data : []
  }

  const models = entries
    .map((entry) => {
      const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
      const rawId = String(record.id ?? record.model ?? record.name ?? '').trim()
      const id = definition.discovery === 'google' ? rawId.replace(/^models\//, '') : rawId
      if (!id || NON_CHAT_MODEL.test(id)) return null
      const label = String(record.display_name ?? record.displayName ?? '').trim() || id
      return {
        id,
        label,
        provider: definition.id,
        capabilities: { ...CAPABILITIES[definition.id] },
      } satisfies ModelOption
    })
    .filter((entry): entry is ModelOption => entry !== null)

  return dedupeModels(models).sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
}

function discoveryError(error: unknown): string {
  if (error instanceof Error && /^HTTP \d+$/.test(error.message)) return error.message
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'The provider timed out.'
  return 'The provider model endpoint could not be reached.'
}

async function catalogFor(definition: ProviderDefinition, options: ProviderCatalogOptions): Promise<CachedModels> {
  const now = Date.now()
  const cached = modelCache.get(definition.id)
  if (!options.force && cached) {
    const ttl = cached.error ? errorTtlMs() : cacheTtlMs()
    if (now - cached.fetchedAt < ttl) return cached
  }
  if (!options.force) {
    const pending = inFlight.get(definition.id)
    if (pending) return pending
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const promise = (async (): Promise<CachedModels> => {
    const fallback = parseFallback(definition.fallback, definition.id)
    if (!definition.configured) return { models: [], fetchedAt: now }
    if (!definition.apiKey) return { models: fallback, fetchedAt: now, source: fallback.length > 0 ? 'fallback' : undefined, error: 'No API key.' }

    try {
      const { url, headers } = modelEndpoint(definition)
      const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(discoveryTimeoutMs()) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const models = parseProviderModels(definition, await response.json())
      if (models.length === 0) throw new Error('HTTP 200')
      return { models, fetchedAt: now, source: 'api' }
    } catch (error) {
      return {
        models: fallback,
        fetchedAt: now,
        source: fallback.length > 0 ? 'fallback' : undefined,
        error: discoveryError(error),
      }
    }
  })()

  inFlight.set(definition.id, promise)
  try {
    const catalog = await promise
    modelCache.set(definition.id, catalog)
    return catalog
  } finally {
    inFlight.delete(definition.id)
  }
}

/** Forget every cached catalog, for a forced refresh or a test. */
export function resetProviderModelCache(): void {
  modelCache.clear()
  inFlight.clear()
}

/**
 * Describe every provider, including the ones that are not configured. Model
 * lists come from each configured provider's own model endpoint, cached in
 * memory; `<PROVIDER>_MODELS` is only a fallback when that endpoint fails.
 * Never returns a key.
 */
export async function listProviders(options: ProviderCatalogOptions = {}): Promise<ProviderInfo[]> {
  const definitionsList = definitions()
  const catalogs = await Promise.all(
    definitionsList.map((definition) =>
      definition.configured ? catalogFor(definition, options) : Promise.resolve<CachedModels>({ models: [], fetchedAt: Date.now() }),
    ),
  )

  return definitionsList.map((definition, index) => {
    const catalog = catalogs[index] ?? { models: [], fetchedAt: Date.now() }
    return {
      id: definition.id,
      label: definition.label,
      configured: definition.configured,
      ...(definition.baseURL ? { baseURL: definition.baseURL } : {}),
      models: definition.configured ? catalog.models : [],
      ...(catalog.source ? { modelsSource: catalog.source } : {}),
      ...(catalog.error ? { modelsError: catalog.error } : {}),
    } satisfies ProviderInfo
  })
}

export async function configuredModels(options: ProviderCatalogOptions = {}): Promise<ModelOption[]> {
  const providers = await listProviders(options)
  return providers.filter((provider) => provider.configured).flatMap((provider) => provider.models)
}

export function modelRefKey(ref: ModelRef): string {
  return `${ref.provider}:${ref.model}`
}

/**
 * Short `provider | model` tag for the run log, so a failure names the model
 * that produced it instead of leaving the operator to guess.
 */
export function modelRefLabel(ref: ModelRef): string {
  return `${ref.provider} | ${ref.model}`
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
export async function modelPool(
  envName: 'EVAL_MODELS' | 'VERIFIER_MODELS',
  size: number,
  options: ProviderCatalogOptions = {},
): Promise<ModelRef[]> {
  const providers = await listProviders(options)
  const catalog = new Map(
    providers
      .filter((provider) => provider.configured)
      .map((provider) => [provider.id, new Set(provider.models.map((model) => model.id))] as const),
  )

  // An explicit pool is kept only for models the provider endpoints actually
  // returned. When none survive, cycle the discovered catalog instead of
  // carrying a dead hardcoded name.
  const parsed = env(envName)
    .split(',')
    .map((entry) => parseModelRef(entry))
    .filter((entry): entry is ModelRef => entry !== null && (catalog.get(entry.provider)?.has(entry.model) ?? false))

  const available =
    parsed.length > 0
      ? parsed
      : providers
          .filter((provider) => provider.configured)
          .flatMap((provider) => provider.models.map((model) => ({ provider: model.provider, model: model.id })))

  if (available.length === 0) return []
  return Array.from({ length: size }, (_, index) => available[index % available.length]!)
}

/**
 * Remove the vendor prefix Runware (and similar gateways) put in front of a
 * model id, so `openai-gpt-6-luna` and `openai/gpt-6-luna` are recognised as
 * the same OpenAI family.
 */
function bareModelId(model: string): string {
  return model.trim().replace(/^(?:openai|azure|azure-openai)[-/:]/i, '')
}

/**
 * OpenAI's reasoning families reject `max_tokens` and only accept
 * `max_completion_tokens`. The AI SDK applies that conversion for its own
 * OpenAI client, but only after matching the bare model id: a gateway id such
 * as `openai-gpt-6-luna` slips through and the request fails with
 * "Unsupported parameter: 'max_tokens' is not supported with this model".
 */
export function usesCompletionTokens(model: string): boolean {
  return /^(?:o\d|gpt-[5-9])/i.test(bareModelId(model))
}

/** Rewrite one JSON request body when it targets a reasoning model. */
export function rewriteCompletionTokens(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return body
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return body
  const request = parsed as Record<string, unknown>
  if (typeof request.model !== 'string' || !usesCompletionTokens(request.model)) return body
  if (request.max_tokens == null) return body
  if (request.max_completion_tokens == null) request.max_completion_tokens = request.max_tokens
  delete request.max_tokens
  return JSON.stringify(request)
}

type FetchFunction = typeof globalThis.fetch

/**
 * Wrap a fetch implementation so every OpenAI-compatible gateway request gets
 * the parameter its model family actually accepts. Non-JSON and non-reasoning
 * requests pass through untouched.
 */
export function withCompletionTokens(fetchImpl: FetchFunction = globalThis.fetch): FetchFunction {
  return (async (input: Parameters<FetchFunction>[0], init?: Parameters<FetchFunction>[1]) => {
    if (init && typeof init.body === 'string') {
      init = { ...init, body: rewriteCompletionTokens(init.body) }
    }
    return fetchImpl(input, init)
  }) as FetchFunction
}

const COMPATIBLE_FETCH = withCompletionTokens()

export function createLanguageModel(ref: ModelRef): LanguageModel {
  const provider = definitions().find((entry) => entry.id === ref.provider)
  if (!provider) throw new Error(`Unknown provider "${ref.provider}".`)
  if (!provider.configured) throw new Error(`Provider "${ref.provider}" is not configured.`)

  switch (ref.provider) {
    case 'meta': {
      const client = createOpenAICompatible({
        name: 'meta',
        baseURL: provider.baseURL ?? 'https://api.meta.ai/v1',
        apiKey: env('MODEL_API_KEY'),
        fetch: COMPATIBLE_FETCH,
      })
      return client(ref.model)
    }
    case 'runware': {
      const client = createOpenAICompatible({
        name: 'runware',
        baseURL: provider.baseURL ?? 'https://api.runware.ai/v1',
        apiKey: env('RUNWARE_API_KEY'),
        fetch: COMPATIBLE_FETCH,
      })
      return client(ref.model)
    }
    case 'groq': {
      const client = createOpenAICompatible({
        name: 'groq',
        baseURL: provider.baseURL ?? 'https://api.groq.com/openai/v1',
        apiKey: env('GROQ_API_KEY'),
        fetch: COMPATIBLE_FETCH,
      })
      return client(ref.model)
    }
    case 'deepseek': {
      const client = createOpenAICompatible({
        name: 'deepseek',
        baseURL: provider.baseURL ?? 'https://api.deepseek.com/v1',
        apiKey: env('DEEPSEEK_API_KEY'),
        fetch: COMPATIBLE_FETCH,
      })
      return client(ref.model)
    }
    case 'nebius': {
      const client = createOpenAICompatible({
        name: 'nebius',
        baseURL: provider.baseURL ?? 'https://api.studio.nebius.ai/v1',
        apiKey: env('NEBIUS_API_KEY'),
        fetch: COMPATIBLE_FETCH,
      })
      return client(ref.model)
    }
    case 'nvidia': {
      const client = createOpenAICompatible({
        name: 'nvidia',
        baseURL: provider.baseURL ?? 'https://integrate.api.nvidia.com/v1',
        apiKey: env('NVIDIA_API_KEY'),
        fetch: COMPATIBLE_FETCH,
      })
      return client(ref.model)
    }
    case 'ollama': {
      const client = createOpenAICompatible({
        name: 'ollama',
        baseURL: withV1(provider.baseURL ?? 'http://localhost:11434'),
        apiKey: env('OLLAMA_API_KEY') || 'ollama',
        fetch: COMPATIBLE_FETCH,
      })
      return client(ref.model)
    }
    case 'openai': {
      const client = createOpenAI({ apiKey: env('OPENAI_API_KEY'), baseURL: provider.baseURL })
      return client(ref.model)
    }
    case 'anthropic': {
      const client = createAnthropic({ apiKey: env('ANTHROPIC_API_KEY'), baseURL: provider.baseURL })
      return client(ref.model)
    }
    case 'google': {
      const client = createGoogleGenerativeAI({
        apiKey: firstEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'),
        baseURL: provider.baseURL,
      })
      return client(ref.model)
    }
    case 'xai': {
      const client = createXai({ apiKey: firstEnv('XAI_API_KEY', 'GROK_API_KEY'), baseURL: provider.baseURL })
      return client(ref.model)
    }
  }
}

export function providerLabel(provider: ProviderId): string {
  return DESCRIPTIONS[provider] ?? provider
}

export type { ModelCapabilities, ModelOption, ModelRef, ProviderId, ProviderInfo }
