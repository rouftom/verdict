import { describe, expect, test } from 'bun:test'
import type { ArenaAgent, ProjectEvidence, ProjectInput } from '@verdict/shared'
import {
  ARENA_PERSONAS,
  arenaCandidateBlock,
  arenaEvidenceBlock,
  arenaPrompt,
  arenaSystem,
  normaliseArenaVote,
  planArenaAgents,
} from './arena'
import type { Rubric } from '@verdict/shared'

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

const rubric: Rubric = {
  version: 1,
  name: 'Test rubric',
  description: 'A rubric used by the arena tests.',
  scale: { min: 0, max: 10, step: 1, anchors: [{ range: [0, 4], label: 'Weak' }] },
  criteria: [
    {
      id: 'clarity',
      label: 'Clarity',
      weight: 1,
      description: 'How clear the project is.',
      questions: ['Is the project clear?'],
      evidence: ['README'],
      signals: ['clear scope'],
      redFlags: ['no evidence'],
    },
  ],
  ranking: {
    scope: 'global',
    primary: 'weighted_score',
    comparativePass: false,
    tieBreakers: [],
    providedRanks: { useInScores: false, compareAfter: false },
    anchors: { source: 'user_selection', max: 3 },
  },
  consensus: {
    evaluators: 1,
    verifiers: 0,
    maxRounds: 1,
    tolerancePoints: 1,
    aggregation: 'mean',
    requireEvidence: false,
    minEvidencePerCriterion: 0,
    verifierAdjustmentLimit: 2,
    onUnresolved: 'average',
  },
  rules: [],
}

const evidence: ProjectEvidence = {
  projectId: 'alpha',
  repo: {
    url: 'docs/alpha',
    owner: 'bundle',
    repo: 'alpha',
    description: 'A local repository.',
    license: 'MIT',
    files: [],
    tree: '',
    readme: 'Alpha README body.',
    keyFiles: [{ path: 'src/main.ts', content: 'export const alpha = true' }],
    filesCount: 12,
    loc: 340,
    languages: { TypeScript: 300, CSS: 40 },
    commits: [],
    fetchedAt: '2026-01-01T00:00:00.000Z',
  },
  video: {
    url: 'videos/alpha.mp4',
    title: 'Alpha demo',
    duration: 90,
    transcript: {
      text: 'We built Alpha.',
      segments: [{ index: 0, start: 2, end: 6, text: 'We built Alpha.' }],
    },
    frames: [{ index: 0, atSeconds: 4, path: 'frames/0001.jpg', caption: 'Dashboard' }],
    fetchedAt: '2026-01-01T00:00:00.000Z',
  },
  errors: [],
}

describe('arena evidence', () => {
  test('reads the repository and video from the attached bundle', () => {
    const block = arenaEvidenceBlock(evidence, 7_000)
    expect(block).toContain('attached offline bundle')
    expect(block).toContain('Alpha README body.')
    expect(block).toContain('src/main.ts')
    expect(block).toContain('We built Alpha.')
    expect(block).toContain('Dashboard')
  })

  test('says so when a candidate has no source in the bundle', () => {
    expect(arenaEvidenceBlock({ projectId: 'beta', errors: [] }, 7_000)).toContain('repository: none in the bundle')
    expect(arenaEvidenceBlock(undefined, 7_000)).toContain('No source was read')
    expect(arenaCandidateBlock({ id: 'beta', name: 'Beta' })).toContain('No source was read')
  })

  test('clips evidence to the budget of the mode', () => {
    const long: ProjectEvidence = {
      ...evidence,
      repo: { ...evidence.repo!, readme: 'x'.repeat(20_000) },
    }
    expect(arenaEvidenceBlock(long, 1_200).length).toBeLessThanOrEqual(1_400)
  })

  test('forbids claiming code execution only when evidence was read', () => {
    expect(arenaSystem(agent, rubric, '', true)).toContain('have not executed the code')
    expect(arenaSystem(agent, rubric, '', false)).toContain('No repository or video was read')
  })

  test('a candidate packet carries its own evidence', () => {
    const prompt = arenaPrompt('duel', candidates.slice(0, 2), { alpha: evidence })
    expect(prompt).toContain('Alpha README body.')
    expect(prompt).toContain('CANDIDATE: beta')
  })
})
