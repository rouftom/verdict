import { describe, expect, test } from 'bun:test'
import { parseRubricText, type EvaluationOutput } from '@verdict/shared'
import { normaliseEvaluation } from './normalise'

const { rubric } = parseRubricText('')

const output: EvaluationOutput = {
  scores: [
    {
      criterionId: ' impact ',
      score: 150,
      confidence: 2,
      evidence: [' repo:a ', 'repo:a', ''],
      rationale: '   ',
      redFlags: ['no-tests', ''],
    },
    { criterionId: 'ai_tooling', score: 60, confidence: 0.5, evidence: [], rationale: 'thin wrapper', redFlags: [] },
    { criterionId: 'technical_depth', score: -5, confidence: 0.8, evidence: ['repo:b'], rationale: 'ok', redFlags: [] },
  ],
  summary: '  ',
  redFlags: ['rule: licence', ' '],
  relativeOrder: [],
}

describe('normaliseEvaluation', () => {
  const evaluation = normaliseEvaluation(output, {
    projectId: 'p1',
    agentId: 'e1',
    agentName: 'Impact & problem fit',
    model: 'anthropic:claude-sonnet-5-5',
    rubric,
  })

  test('returns every rubric criterion once, in rubric order', () => {
    expect(evaluation.scores.map((score) => score.criterionId)).toEqual(rubric.criteria.map((criterion) => criterion.id))
  })

  test('clamps scores and confidence to the rubric scale', () => {
    expect(evaluation.scores[0]?.score).toBe(100)
    expect(evaluation.scores[0]?.confidence).toBe(1)
    expect(evaluation.scores[2]?.score).toBe(0)
  })

  test('deduplicates evidence and falls back on an empty rationale', () => {
    expect(evaluation.scores[0]?.evidence).toEqual(['repo:a'])
    expect(evaluation.scores[0]?.rationale).toBe('No rationale returned.')
  })

  test('flags missing criteria and keeps project-level red flags', () => {
    expect(evaluation.scores[3]?.score).toBe(0)
    expect(evaluation.redFlags).toContain('missing-criterion:demo')
    expect(evaluation.redFlags).toContain('no-tests')
    expect(evaluation.redFlags).toContain('rule: licence')
  })

  test('computes the weighted overall from the normalised scores', () => {
    expect(evaluation.overall).toBe(45)
    expect(evaluation.summary).toBe('')
  })
})
