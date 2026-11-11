import type { RunEvent, RunStatus } from '@verdict/shared'

/**
 * Timing derived from the event stream, so the graph can show a live duration
 * without a second API. Every value is an epoch millisecond timestamp.
 */
export interface Timing {
  start: number
  end?: number
}

/** Stage events carry the pipeline step as their message. */
const STAGE_OF: Record<string, string> = {
  harvesting: 'harvest',
  evaluating: 'evaluate',
  reviewing: 'review',
  consensus: 'consensus',
  verifying: 'verify',
  reporting: 'report',
}

/** Compact duration, the same grammar the reference project uses. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds ? `${minutes} min ${String(seconds).padStart(2, '0')}s` : `${minutes} min`
}

export function eventTime(event: RunEvent): number | undefined {
  const at = Date.parse(event.at)
  return Number.isNaN(at) ? undefined : at
}

/**
 * Start and end of each pipeline stage. A stage ends when the next stage
 * starts, and the report event closes the last one.
 */
export function stageTimings(events: RunEvent[]): Map<string, Timing> {
  const stages = new Map<string, Timing>()
  let current: string | undefined

  for (const event of events) {
    const at = eventTime(event)
    if (at === undefined) continue
    if (event.type === 'stage' && event.message) {
      const id = STAGE_OF[event.message]
      if (!id) continue
      const previous = current ? stages.get(current) : undefined
      if (previous && previous.end === undefined) previous.end = at
      current = id
      if (!stages.has(id)) stages.set(id, { start: at })
      continue
    }
    if (event.type === 'report' && current) {
      const timing = stages.get(current)
      if (timing && timing.end === undefined) timing.end = at
    }
  }
  return stages
}

/**
 * The report has its own stage event (`reporting`), emitted when the final
 * ranking starts, and it closes at the report event. Without that stage the
 * report node used to inherit the harvest range and displayed the duration of
 * the whole run, so it now shows nothing rather than a wrong number.
 */
export function reportTiming(events: RunEvent[]): Timing | undefined {
  const stages = stageTimings(events)
  const timing = stages.get('report')
  if (!timing || timing.end === undefined) return undefined
  return { start: timing.start, end: timing.end }
}

const STATUS_OF_STAGE: Record<string, RunStatus> = {
  harvesting: 'harvesting',
  evaluating: 'evaluating',
  reviewing: 'reviewing',
  consensus: 'consensus',
  verifying: 'verifying',
}

/**
 * Status rebuilt from the event stream, used when the snapshot lost it. The
 * last stage event is the current step; a report event already closed the run.
 */
export function statusFromEvents(events: RunEvent[]): RunStatus | undefined {
  if (events.some((event) => event.type === 'report')) return 'done'
  let status: RunStatus | undefined
  for (const event of events) {
    if (event.type !== 'stage' || !event.message) continue
    const mapped = STATUS_OF_STAGE[event.message]
    if (mapped) status = mapped
  }
  return status
}

function agentOf(event: RunEvent): string | undefined {
  if (!event.data || typeof event.data !== 'object') return undefined
  const data = event.data as Record<string, unknown>
  return typeof data.agentId === 'string'
    ? data.agentId
    : typeof data.verifierId === 'string'
      ? data.verifierId
      : undefined
}

function stageOfResult(type: RunEvent['type']): string {
  if (type === 'verification') return 'verify'
  if (type === 'revision') return 'review'
  return 'evaluate'
}

/**
 * Start and end of each agent's latest result. The result's own event closes
 * it; an agent with no result yet is still running from the stage start.
 */
export function agentTimings(events: RunEvent[], stages: Map<string, Timing>): Map<string, Timing> {
  const timings = new Map<string, Timing>()
  for (const event of events) {
    if (event.type !== 'evaluation' && event.type !== 'revision' && event.type !== 'verification') continue
    const agentId = agentOf(event)
    const at = eventTime(event)
    if (!agentId || at === undefined) continue
    const stage = stages.get(stageOfResult(event.type))
    timings.set(agentId, { start: stage?.start ?? at, end: at })
  }
  return timings
}

/** A live duration for a stage that may not have ended yet. */
export function durationOf(timing: Timing | undefined, now: number): string | undefined {
  if (!timing) return undefined
  return formatElapsed((timing.end ?? now) - timing.start)
}
