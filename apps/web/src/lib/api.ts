import type {
  AgentPool,
  ManifestParseResult,
  ModelRef,
  OfflineMapping,
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
    /** Attached zip already cached by the API; the run never fetches a source. */
    offline?: { id: string; label?: string; mapping?: OfflineMapping }
  }
}

export interface OfflineInputsPayload {
  manifestText?: string
  manifestFilename?: string
  rulesText?: string
  rulesFilename?: string
  rubricText?: string
  rubricFilename?: string
}

/** A repository or video the picker can choose, addressed by a bundle path. */
export interface OfflineCandidate {
  path: string
  label: string
}

export interface OfflineUploadResponse {
  id: string
  label: string
  bytes: number
  files: number
  repos: number
  videos: number
  inputs: OfflineInputsPayload | null
  detected: { manifest: boolean; rules: boolean; rubric: boolean }
  projects: Array<{ id: string; name: string }>
  candidates: { repositories: OfflineCandidate[]; videos: OfflineCandidate[] }
  mapping: OfflineMapping
  warnings: string[]
}

export interface OfflineMatchResponse {
  mapping: OfflineMapping
  /** The agent's short summary of what it read and decided. */
  notes: string
  warnings: string[]
}

/** Ask the chosen model to read the bundle and match its projects. */
export function matchOfflineBundle(
  id: string,
  manifestText: string,
  model?: ModelRef,
): Promise<OfflineMatchResponse> {
  return request<OfflineMatchResponse>(`/offline/bundles/${encodeURIComponent(id)}/match`, {
    method: 'POST',
    body: JSON.stringify({ manifestText, ...(model ? { model } : {}) }),
  })
}

/**
 * Upload the bundle with XHR, not fetch: upload progress is only observable on
 * the former, and a multi-gigabyte zip needs a visible progress bar.
 */
export function uploadOfflineBundle(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<OfflineUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/offline/bundles?filename=${encodeURIComponent(file.name)}`)
    xhr.setRequestHeader('Content-Type', file.type || 'application/zip')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      let body: (OfflineUploadResponse & { error?: string }) | null = null
      try {
        body = JSON.parse(xhr.responseText) as OfflineUploadResponse & { error?: string }
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) {
        resolve(body)
        return
      }
      reject(new Error(body?.error ?? `Upload failed (${xhr.status}).`))
    }
    xhr.onerror = () => reject(new Error('Upload failed: the API could not be reached.'))
    xhr.onabort = () => reject(new Error('Upload cancelled.'))
    xhr.send(file)
  })
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
