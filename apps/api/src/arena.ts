import { randomUUID } from 'node:crypto'
import { planArenaAgents, runArena } from '@verdict/eval'
import { harvestProject } from '@verdict/harvest'
import { listProviders } from '@verdict/providers'
import {
  parseManifestText,
  parseRubricText,
  type ArenaEvent,
  type ArenaRequest,
  type ArenaSnapshot,
  type ArenaVote,
  type ProjectEvidence,
} from '@verdict/shared'
import { prepareOfflineHarvest } from './offline'

/** Same caps as a full run: a bundle must not turn a quick vote into a crawl. */
const OFFLINE_MAX_VIDEO_MINUTES = 20
const OFFLINE_FRAME_INTERVAL_SECONDS = 20

const arenas = new Map<string, ArenaSnapshot>()
const subscribers = new Map<string, Set<(event: ArenaEvent) => void>>()
const controllers = new Map<string, AbortController>()

function pushEvent(snapshot: ArenaSnapshot, event: ArenaEvent): void {
  snapshot.events.push(event)
  if (snapshot.events.length > Number(process.env.MAX_EVENTS_PER_ARENA ?? 2000)) snapshot.events.splice(0, 300)
  snapshot.updatedAt = event.at
  for (const subscriber of subscribers.get(snapshot.id) ?? []) {
    try {
      subscriber(event)
    } catch {
      /* a dead SSE client must not stop the arena */
    }
  }
}

/**
 * Open an arena and start its voters immediately. The population is resolved
 * once, so a restart or a reload still shows the same agents and lenses.
 */
export async function createArena(input: ArenaRequest): Promise<ArenaSnapshot> {
  const parsed = parseManifestText(input.manifestText)
  const known = new Map(parsed.projects.map((project) => [project.id, project]))
  const missing = input.candidateIds.filter((id) => !known.has(id))
  if (missing.length > 0) {
    throw new Error(`Unknown candidate(s): ${missing.join(', ')}.`)
  }
  const candidates = input.candidateIds.map((id) => known.get(id)!).filter(Boolean)
  const rubric = parseRubricText('').rubric
  const agents = planArenaAgents(input.agents)
  if (agents.length === 0) throw new Error('Add at least one agent to the population.')

  const providers = await listProviders()
  const configured = new Set(providers.filter((provider) => provider.configured).map((provider) => provider.id))
  for (const agent of agents) {
    if (!configured.has(agent.model.provider)) {
      throw new Error(`Provider "${agent.model.provider}" is not configured.`)
    }
  }

  if (arenas.size >= Number(process.env.MAX_ARENAS_IN_MEMORY ?? 20)) {
    const oldest = [...arenas.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]
    if (oldest) arenas.delete(oldest.id)
  }

  const now = new Date().toISOString()
  const snapshot: ArenaSnapshot = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: 'queued',
    mode: input.mode,
    candidates,
    rules: input.rulesText,
    rubricName: rubric.name,
    agents,
    votes: [],
    events: [],
  }
  arenas.set(snapshot.id, snapshot)
  void execute(snapshot, input)
  return snapshot
}

async function execute(snapshot: ArenaSnapshot, input: ArenaRequest): Promise<void> {
  const controller = new AbortController()
  controllers.set(snapshot.id, controller)
  snapshot.status = 'running'
  const emit = (event: Omit<ArenaEvent, 'arenaId'> & { arenaId?: string }) => {
    if (controller.signal.aborted) return
    pushEvent(snapshot, { ...event, arenaId: snapshot.id })
  }
  try {
    let evidence: Record<string, ProjectEvidence> | undefined
    if (input.offline) {
      emit({
        type: 'stage',
        at: new Date().toISOString(),
        message: 'reading',
        data: { candidates: snapshot.candidates.length, label: input.offline.label },
      })
      const prepared = await prepareOfflineHarvest(
        input.offline.id,
        snapshot.candidates,
        input.offline.mapping ?? {},
      )
      for (const warning of prepared.warnings.slice(0, 8)) {
        emit({ type: 'log', at: new Date().toISOString(), message: warning })
      }
      const read: Record<string, ProjectEvidence> = {}
      let matched = 0
      for (const project of snapshot.candidates) {
        if (controller.signal.aborted) throw new Error('Arena cancelled.')
        const item = await harvestProject(project, {
          offline: prepared.harvest,
          maxVideoMinutes: OFFLINE_MAX_VIDEO_MINUTES,
          frameIntervalSeconds: OFFLINE_FRAME_INTERVAL_SECONDS,
          signal: controller.signal,
          onLog: (message) => emit({ type: 'log', at: new Date().toISOString(), message }),
        })
        read[project.id] = item
        if (item.repo || item.video) matched += 1
        for (const error of item.errors) {
          emit({ type: 'log', at: new Date().toISOString(), message: `${project.name}: ${error}` })
        }
      }
      evidence = read
      snapshot.offline = {
        ...(input.offline.label ? { label: input.offline.label } : {}),
        matched,
      }
      emit({
        type: 'log',
        at: new Date().toISOString(),
        message: `Offline bundle read for ${matched} of ${snapshot.candidates.length} candidate(s).`,
      })
    }

    const result = await runArena({
      arenaId: snapshot.id,
      mode: snapshot.mode,
      candidates: snapshot.candidates,
      rulesText: snapshot.rules,
      rubric: parseRubricText('').rubric,
      agents: snapshot.agents,
      temperature: input.temperature ?? 0.4,
      ...(evidence ? { evidence } : {}),
      signal: controller.signal,
      onEvent: (event) => {
        if (controller.signal.aborted) return
        pushEvent(snapshot, event)
        if (event.type === 'vote' && event.data) {
          const vote = event.data as ArenaVote
          const index = snapshot.votes.findIndex((entry) => entry.agentId === vote.agentId)
          if (index >= 0) snapshot.votes[index] = vote
          else snapshot.votes.push(vote)
        }
      },
    })
    if (controller.signal.aborted) throw new Error('Arena cancelled.')
    snapshot.votes = result.votes
    snapshot.status = 'done'
    snapshot.updatedAt = new Date().toISOString()
    pushEvent(snapshot, {
      type: 'log',
      arenaId: snapshot.id,
      at: snapshot.updatedAt,
      message: `Arena closed with ${result.votes.length} ballot(s) in ${result.usage.calls} model call(s).`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    snapshot.status = controller.signal.aborted ? 'cancelled' : 'failed'
    snapshot.error = message
    snapshot.updatedAt = new Date().toISOString()
    pushEvent(snapshot, { type: 'error', arenaId: snapshot.id, at: snapshot.updatedAt, message })
  } finally {
    controllers.delete(snapshot.id)
    subscribers.delete(snapshot.id)
  }
}

export function getArena(id: string): ArenaSnapshot | undefined {
  return arenas.get(id)
}

export function listArenas(): ArenaSnapshot[] {
  return [...arenas.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function cancelArena(id: string): boolean {
  const controller = controllers.get(id)
  if (!controller) return false
  const snapshot = arenas.get(id)
  if (snapshot) {
    snapshot.status = 'cancelled'
    snapshot.updatedAt = new Date().toISOString()
  }
  controller.abort()
  return true
}

export function subscribe(id: string, listener: (event: ArenaEvent) => void): () => void {
  const set = subscribers.get(id) ?? new Set()
  set.add(listener)
  subscribers.set(id, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) subscribers.delete(id)
  }
}
