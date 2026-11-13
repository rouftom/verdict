import { describe, expect, test } from 'bun:test'
import { arenaRequestSchema, runOptionsSchema, stageOneOutputSchema } from './schemas'

describe('runOptionsSchema', () => {
  test('caches harvested resources by default', () => {
    expect(runOptionsSchema.parse({}).cacheResources).toBe(true)
  })

  test('keeps an explicit opt-out', () => {
    expect(runOptionsSchema.parse({ cacheResources: false }).cacheResources).toBe(false)
  })
})

describe('stageOneOutputSchema', () => {
  test('requires both gate checks', () => {
    expect(stageOneOutputSchema.parse({ themeFit: true, toolingUse: true }).rationale).toBe('')
    expect(() => stageOneOutputSchema.parse({ themeFit: true })).toThrow()
  })
})

const arena = {
  mode: 'duel' as const,
  manifestText: '[]',
  manifestFilename: 'manifest.json',
  rulesText: '',
  rulesFilename: 'rules.md',
  candidateIds: ['alpha', 'beta'],
  agents: [{ model: { provider: 'openai' as const, model: 'one' }, count: 3 }],
}

describe('arenaRequestSchema', () => {
  test('accepts a two-candidate duel', () => {
    const parsed = arenaRequestSchema.parse(arena)
    expect(parsed.candidateIds).toEqual(['alpha', 'beta'])
    expect(parsed.temperature).toBe(0.4)
  })

  test('rejects a duel with more than two candidates', () => {
    expect(() =>
      arenaRequestSchema.parse({ ...arena, candidateIds: ['alpha', 'beta', 'gamma'] }),
    ).toThrow()
  })

  test('rejects duplicate candidates and more than 24 agents', () => {
    expect(() => arenaRequestSchema.parse({ ...arena, candidateIds: ['alpha', 'alpha'] })).toThrow()
    expect(() =>
      arenaRequestSchema.parse({ ...arena, agents: [{ model: { provider: 'openai', model: 'one' }, count: 12 }, { model: { provider: 'openai', model: 'two' }, count: 12 }, { model: { provider: 'openai', model: 'three' }, count: 1 }] }),
    ).toThrow()
  })

  test('allows a grid of up to eight candidates', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    expect(arenaRequestSchema.parse({ ...arena, mode: 'grid', candidateIds: ids }).candidateIds).toHaveLength(8)
  })
})
