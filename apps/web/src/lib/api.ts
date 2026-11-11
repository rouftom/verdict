import type {
  AgentPool,
  ManifestParseResult,
  ModelRef,
  ProjectInput,
  ProviderInfo,
  RunEvent,
  RunSnapshot,
  Rubric,
} from '@verdict/shared'

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8010').replace(/\/+$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status}).`)
  return body
}

export interface RunRequest {
  manifestText: string
  manifestFilename: string
  rulesText: string
  rulesFilename: string
  rubricText?: string
  rubricFilename?: string
  options: {
    evaluatorModels: ModelRef[]
    verifierModels: ModelRef[]
    showRanksToAgents: boolean
    cacheResources: boolean
    anchors: string[]
    maxRounds: number
    temperature: number
    concurrency: number
    maxVideoMinutes: number
    frameIntervalSeconds: number
  }
}

export interface PreviewResponse {
  projects: ProjectInput[]
  rubric: Rubric
  rulesChars: number
  warnings: string[]
}

export interface RunSummary {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  projects: number
  rubric: string
  reportReady: boolean
  error?: string
}

export interface ProviderResponse {
  providers: ProviderInfo[]
  defaults: {
    evaluators: ModelRef[]
    verifiers: ModelRef[]
  }
  agents: AgentPool
}

export function fetchProviders(): Promise<ProviderResponse> {
  return request('/providers')
}

export function previewInputs(input: {
  manifestText: string
  rubricText?: string
  rubricFilename?: string
  rulesText?: string
}): Promise<PreviewResponse> {
  return request('/runs/preview', { method: 'POST', body: JSON.stringify(input) })
}

export function parseManifest(text: string): Promise<ManifestParseResult> {
  return request('/parse/manifest', { method: 'POST', body: JSON.stringify({ text }) })
}

export function createRun(input: RunRequest): Promise<{ id: string; status: string; createdAt: string }> {
  return request('/runs', { method: 'POST', body: JSON.stringify(input) })
}

export function fetchRun(id: string): Promise<RunSnapshot> {
  return request(`/runs/${id}`)
}

export function fetchRuns(): Promise<{ runs: RunSummary[] }> {
  return request('/runs')
}

export function cancelRun(id: string): Promise<{ cancelled: boolean; status: string }> {
  return request(`/runs/${id}/cancel`, { method: 'POST', body: '{}' })
}

export function pauseRun(id: string): Promise<{ paused: boolean; status: string }> {
  return request(`/runs/${id}/pause`, { method: 'POST', body: '{}' })
}

export function resumeRun(id: string): Promise<{ paused: boolean; status: string }> {
  return request(`/runs/${id}/resume`, { method: 'POST', body: '{}' })
}

/** Subscribe to a run's SSE stream. Returns a disposer. */
export function subscribeRun(id: string, onEvent: (event: RunEvent) => void, onError?: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const source = new EventSource(`${API_BASE}/runs/${id}/events`)
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as RunEvent)
    } catch {
      /* ignore a malformed frame */
    }
  }
  source.onerror = () => {
    onError?.()
    source.close()
  }
  return () => source.close()
}
