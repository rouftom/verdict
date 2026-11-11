import { describe, expect, test } from 'bun:test'
import type { RunEvent } from '@verdict/shared'
import { agentTimings, durationOf, formatElapsed, stageTimings } from './run-timeline'

function event(at: string, type: RunEvent['type'], message?: string, data?: unknown): RunEvent {
  return { runId: 'run', at, type, ...(message ? { message } : {}), ...(data ? { data } : {}) }
}

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString()

describe('formatElapsed', () => {
  test('uses seconds below a minute and padded minutes above', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(18_400)).toBe('18s')
    expect(formatElapsed(65_000)).toBe('1 min 05s')
    expect(formatElapsed(180_000)).toBe('3 min')
  })
})

describe('stageTimings', () => {
  const events = [
    event(at(0), 'stage', 'harvesting'),
    event(at(10), 'stage', 'evaluating'),
    event(at(40), 'stage', 'reviewing'),
    event(at(50), 'stage', 'consensus'),
    event(at(60), 'stage', 'verifying'),
    event(at(90), 'report', 'report'),
  ]

  test('closes each stage when the next one starts', () => {
    const stages = stageTimings(events)
    expect(stages.get('harvest')).toEqual({ start: Date.parse(at(0)), end: Date.parse(at(10)) })
    expect(stages.get('evaluate')).toEqual({ start: Date.parse(at(10)), end: Date.parse(at(40)) })
    expect(stages.get('verify')).toEqual({ start: Date.parse(at(60)), end: Date.parse(at(90)) })
  })

  test('leaves the last stage open while the run is live', () => {
    const stages = stageTimings(events.slice(0, 5))
    expect(stages.get('verify')?.end).toBeUndefined()
    expect(durationOf(stages.get('verify'), Date.parse(at(75)))).toBe('15s')
  })

  test('ignores duplicate stage events from a replayed snapshot', () => {
    const stages = stageTimings([...events, event(at(100), 'stage', 'verifying')])
    expect(stages.get('verify')?.start).toBe(Date.parse(at(60)))
  })
})

describe('agentTimings', () => {
  const events = [
    event(at(0), 'stage', 'harvesting'),
    event(at(10), 'stage', 'evaluating'),
    event(at(25), 'evaluation', 'Impact → 80', { agentId: 'e1', agentName: 'Impact' }),
    event(at(40), 'stage', 'reviewing'),
    event(at(55), 'revision', 'Impact revised', { agentId: 'e1', agentName: 'Impact' }),
    event(at(60), 'stage', 'verifying'),
    event(at(85), 'verification', 'Rubric → 78', { verifierId: 'v1', verifierName: 'Rubric' }),
  ]

  test('starts at the stage and ends at the agent result', () => {
    const stages = stageTimings(events)
    const timings = agentTimings(events, stages)
    expect(timings.get('e1')).toEqual({ start: Date.parse(at(40)), end: Date.parse(at(55)) })
    expect(timings.get('v1')).toEqual({ start: Date.parse(at(60)), end: Date.parse(at(85)) })
  })

  test('keeps an unfinished agent live from its stage start', () => {
    const stages = stageTimings(events.slice(0, 2))
    const timings = agentTimings(events.slice(0, 2), stages)
    expect(durationOf(timings.get('e9'), Date.parse(at(30)))).toBeUndefined()
    expect(durationOf(stages.get('evaluate'), Date.parse(at(30)))).toBe('20s')
  })
})
