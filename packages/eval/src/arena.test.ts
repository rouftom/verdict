import { describe, expect, test } from 'bun:test'
import type { ArenaAgent, ProjectInput } from '@verdict/shared'
import { ARENA_PERSONAS, normaliseArenaVote, planArenaAgents } from './arena'

const candidates: ProjectInput[] = [
  { id: 'alpha', name: 'Alpha' },
  { id: 'beta', name: 'Beta' },
  { id: 'gamma', name: 'Gamma' },
]

const agent: ArenaAgent = {
  id: 'a1',
  personaId: 'evidence',
  name: 'Evidence auditor',
  lens: 'Evidence',
  focus: 'Checks the evidence.',
  model: { provider: 'openai', model: 'gpt-test' },
}

describe('planArenaAgents', () => {
  test('turns population rows into agents and keeps each model', () => {
    const agents = planArenaAgents([
      { model: { provider: 'openai', model: 'one' }, count: 2 },
      { model: { provider: 'anthropic', model: 'two' }, count: 1 },
    ])
    expect(agents).toHaveLength(3)
    expect(agents.map((entry) => entry.model.model)).toEqual(['one', 'one', 'two'])
    expect(new Set(agents.map((entry) => entry.id)).size).toBe(3)
  })

  test('cycles the personas so a large population is not one lens', () => {
    const agents = planArenaAgents([{ model: { provider: 'openai', model: 'one' }, count: ARENA_PERSONAS.length + 2 }])
    expect(agents[0]!.lens).toBe(ARENA_PERSONAS[0]!.lens)
    expect(agents[ARENA_PERSONAS.length]!.lens).toBe(ARENA_PERSONAS[0]!.lens)
    expect(agents[1]!.lens).toBe(ARENA_PERSONAS[1]!.lens)
  })
})

describe('normaliseArenaVote', () => {
  test('fills a rejection for every losing candidate', () => {
    const result = normaliseArenaVote(
      agent,
      {
        chosenProjectId: 'alpha',
        confidence: 0.8,
        rationale: 'Alpha is the clearest.',
        rejections: [{ projectId: 'beta', reason: 'Beta is thinner.' }],
      },
      candidates,
      '2026-01-01T00:00:00.000Z',
    )
    expect(result.vote.rejections).toEqual([
      { projectId: 'beta', reason: 'Beta is thinner.' },
      { projectId: 'gamma', reason: 'No argument was given for this candidate.' },
    ])
    expect(result.warnings).toHaveLength(1)
    expect(result.vote.model).toBe('openai:gpt-test')
  })

  test('rejects a winner that is not on the stage', () => {
    expect(() =>
      normaliseArenaVote(
        agent,
        { chosenProjectId: 'delta', confidence: 0.5, rationale: '', rejections: [] },
        candidates,
      ),
    ).toThrow()
  })
})
