import { randomUUID } from 'node:crypto'
import {
  buildConsensus,
  parseManifestText,
  parseRubricText,
  runOptionsSchema,
  type ProjectConsensus,
  type ProjectEvaluation,
  type ProjectEvidence,
  type ProjectInput,
  type ProjectRevision,
  type ProjectVerification,
  type RunEvent,
  type RunOptions,
  type RunSnapshot,
  type Rubric,
} from '@verdict/shared'
import { runEvaluation } from '@verdict/eval'
import { listProviders, modelPool, type ModelRef } from '@verdict/providers'

export interface CreateRunInput {
  manifestText: string
  manifestFilename?: string
  rulesText?: string
  rulesFilename?: string
  rubricText?: string
  rubricFilename?: string
  options?: Partial<RunOptions>
}

export interface ParsedInputs {
  manifest: ProjectInput[]
  rubric: Rubric
  rulesText: string
  warnings: string[]
}

const runs = new Map<string, RunSnapshot>()
const subscribers = new Map<string, Set<(event: RunEvent) => void>>()
const controllers = new Map<string, AbortController>()

/**
 * A pause gate sits between two pipeline steps. Pausing lets the calls already
 * in flight finish, then holds every worker on `wait()` until the user resumes
 * or cancels (cancelling releases the waiters through the abort signal).
 */
interface RunGate {
  paused: boolean
  wait: (signal?: AbortSignal) => Promise<void>
  pause: () => void
  resume: () => void
}

const gates = new Map<string, RunGate>()

function createGate(): RunGate {
  const waiters = new Set<() => void>()
  const gate: RunGate = {
    paused: false,
    wait(signal) {
      if (!gate.paused || signal?.aborted) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const release = () => {
          signal?.removeEventListener('abort', release)
          waiters.delete(release)
          resolve()
        }
        waiters.add(release)
        signal?.addEventListener('abort', release, { once: true })
      })
    },
    pause() {
      gate.paused = true
    },
    resume() {
      gate.paused = false
      for (const release of [...waiters]) release()
    },
  }
  return gate
}

export function parseInputs(input: CreateRunInput): ParsedInputs {
  const manifest = parseManifestText(input.manifestText)
  const rubric = parseRubricText(input.rubricText ?? '', input.rubricFilename)
  return {
    manifest: manifest.projects,
    rubric: rubric.rubric,
    rulesText: input.rulesText ?? '',
    warnings: [...manifest.warnings, ...rubric.warnings],
  }
}

async function resolveModels(): Promise<{ evaluators: ModelRef[]; verifiers: ModelRef[] }> {
  const evaluators = await modelPool('EVAL_MODELS', 6)
  const verifiers = await modelPool('VERIFIER_MODELS', 2)
  return { evaluators, verifiers }
}

export async function createRun(input: CreateRunInput): Promise<RunSnapshot> {
  const parsed = parseInputs(input)
  const options = runOptionsSchema.parse(input.options ?? {})
  const pools = await resolveModels()

  const evaluatorModels = options.evaluatorModels.length > 0 ? options.evaluatorModels : pools.evaluators
  const verifierModels = options.verifierModels.length > 0 ? options.verifierModels : pools.verifiers
  if (evaluatorModels.length === 0) throw new Error('No evaluator model is configured. Add a provider key or a model to the provider catalog.')
  if (verifierModels.length === 0) throw new Error('No verifier model is configured. Add a provider key or a model to the provider catalog.')

  const providers = await listProviders()
  const configured = new Set(providers.filter((provider) => provider.configured).map((provider) => provider.id))
  for (const model of [...evaluatorModels, ...verifierModels]) {
    if (!configured.has(model.provider)) throw new Error(`Provider "${model.provider}" is not configured.`)
  }

  if (runs.size >= Number(process.env.MAX_RUNS_IN_MEMORY ?? 20)) {
    const oldest = [...runs.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]
    if (oldest) runs.delete(oldest.id)
  }

  const now = new Date().toISOString()
  const snapshot: RunSnapshot = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: 'queued',
    options: { ...options, evaluatorModels, verifierModels },
    rules: parsed.rulesText,
    manifest: parsed.manifest,
    rubric: parsed.rubric,
    evidence: [],
    evaluations: [],
    revisions: [],
    consensus: [],
    verifications: [],
    events: [],
    warnings: parsed.warnings,
  }
  runs.set(snapshot.id, snapshot)
  void execute(snapshot, evaluatorModels, verifierModels)
  return snapshot
}

function pushEvent(snapshot: RunSnapshot, event: RunEvent): void {
  snapshot.events.push(event)
  if (snapshot.events.length > Number(process.env.MAX_EVENTS_PER_RUN ?? 4000)) snapshot.events.splice(0, 500)
  snapshot.updatedAt = event.at
  for (const subscriber of subscribers.get(snapshot.id) ?? []) {
    try {
      subscriber(event)
    } catch {
      /* a dead SSE client must not stop the run */
    }
  }
}

function upsert<T extends { projectId: string }>(items: T[], next: T): void {
  const index = items.findIndex((item) => item.projectId === next.projectId && (item as { agentId?: string }).agentId === (next as { agentId?: string }).agentId && (item as { verifierId?: string }).verifierId === (next as { verifierId?: string }).verifierId)
  if (index >= 0) items[index] = next
  else items.push(next)
}

async function execute(snapshot: RunSnapshot, evaluatorModels: ModelRef[], verifierModels: ModelRef[]): Promise<void> {
  const controller = new AbortController()
  controllers.set(snapshot.id, controller)
  const gate = createGate()
  gates.set(snapshot.id, gate)
  snapshot.status = 'harvesting'
  try {
    const result = await runEvaluation({
      runId: snapshot.id,
      manifest: snapshot.manifest,
      rubric: snapshot.rubric,
      rulesText: snapshot.rules,
      options: snapshot.options,
      evaluatorModels,
      verifierModels,
      signal: controller.signal,
      warnings: snapshot.warnings,
      waitForResume: (signal) => gate.wait(signal),
      onEvent: (event) => {
        // Once the run is aborted, late events from an in-flight model call must
        // not flip the status back to an active stage.
        if (controller.signal.aborted) return
        pushEvent(snapshot, event)
        switch (event.type) {
          case 'stage':
            snapshot.status = event.message === 'harvesting' ? 'harvesting' : event.message === 'evaluating' ? 'evaluating' : event.message === 'reviewing' ? 'reviewing' : event.message === 'consensus' ? 'consensus' : event.message === 'verifying' ? 'verifying' : snapshot.status
            break
          case 'evaluation':
            upsert(snapshot.evaluations, event.data as ProjectEvaluation)
            break
          case 'revision':
            upsert(snapshot.revisions, event.data as ProjectRevision)
            break
          case 'consensus':
            snapshot.consensus = [...snapshot.consensus.filter((entry) => entry.projectId !== (event.data as ProjectConsensus).projectId), event.data as ProjectConsensus]
            break
          case 'verification':
            upsert(snapshot.verifications, event.data as ProjectVerification)
            break
          case 'report':
            snapshot.report = event.data as RunSnapshot['report']
            break
          default:
            break
        }
      },
    })
    snapshot.evidence = result.evidence
    snapshot.report = result.report
    snapshot.warnings = result.warnings
    if (controller.signal.aborted) throw new Error('Run cancelled.')
    snapshot.status = 'done'
    snapshot.updatedAt = new Date().toISOString()
    pushEvent(snapshot, { type: 'log', runId: snapshot.id, at: snapshot.updatedAt, message: `done in ${result.usage.calls} model call(s)` })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    snapshot.status = controller.signal.aborted ? 'cancelled' : 'failed'
    snapshot.error = message
    snapshot.updatedAt = new Date().toISOString()
    pushEvent(snapshot, { type: 'error', runId: snapshot.id, at: snapshot.updatedAt, message })
  } finally {
    controllers.delete(snapshot.id)
    gates.delete(snapshot.id)
    subscribers.delete(snapshot.id)
  }
}

export function getRun(id: string): RunSnapshot | undefined {
  return runs.get(id)
}

export function listRuns(): RunSnapshot[] {
  return [...runs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function cancelRun(id: string): boolean {
  const controller = controllers.get(id)
  if (!controller) return false
  const snapshot = runs.get(id)
  if (snapshot) {
    snapshot.status = 'cancelled'
    snapshot.paused = false
    snapshot.updatedAt = new Date().toISOString()
  }
  gates.get(id)?.resume()
  controller.abort()
  return true
}

/** Hold the run at its next step boundary. In-flight calls are not killed. */
export function pauseRun(id: string): { paused: boolean } | undefined {
  const gate = gates.get(id)
  const snapshot = runs.get(id)
  if (!gate || !snapshot) return undefined
  if (gate.paused) return { paused: true }
  gate.pause()
  snapshot.paused = true
  const at = new Date().toISOString()
  snapshot.updatedAt = at
  pushEvent(snapshot, { type: 'log', runId: id, at, message: 'Run paused. Calls in flight will finish, then the pipeline holds.' })
  return { paused: true }
}

/** Release a paused run. */
export function resumeRun(id: string): { paused: boolean } | undefined {
  const gate = gates.get(id)
  const snapshot = runs.get(id)
  if (!gate || !snapshot) return undefined
  if (!gate.paused) return { paused: false }
  gate.resume()
  snapshot.paused = false
  const at = new Date().toISOString()
  snapshot.updatedAt = at
  pushEvent(snapshot, { type: 'log', runId: id, at, message: 'Run resumed.' })
  return { paused: false }
}

export function subscribe(id: string, listener: (event: RunEvent) => void): () => void {
  const set = subscribers.get(id) ?? new Set()
  set.add(listener)
  subscribers.set(id, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) subscribers.delete(id)
  }
}

export function seedConsensus(snapshot: RunSnapshot): void {
  snapshot.consensus = snapshot.manifest.map((project) =>
    buildConsensus(project.id, snapshot.evaluations.filter((evaluation) => evaluation.projectId === project.id), snapshot.rubric),
  )
}

export type { ProjectEvidence, ProjectConsensus }
