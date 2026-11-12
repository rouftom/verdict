import { describe, expect, test } from 'bun:test'
import { parseRubricText, type EvaluationOutput } from '@verdict/shared'
import { assertCompleteEvaluation, assertReadableScores, mergeRevisionOutput, normaliseEvaluation, normaliseRevision } from './normalise'

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

describe('assertCompleteEvaluation', () => {
  test('rejects a score list that omits a rubric criterion', () => {
    expect(() => assertCompleteEvaluation(output, rubric)).toThrow('demo')
  })

  test('accepts one score per rubric criterion', () => {
    const complete: EvaluationOutput = {
      ...output,
      scores: [
        ...output.scores,
        { criterionId: 'demo', score: 70, confidence: 0.7, evidence: [], rationale: 'ok', redFlags: [] },
      ],
    }
    expect(() => assertCompleteEvaluation(complete, rubric)).not.toThrow()
  })

  test('rejects a score that is not a number', () => {
    const complete: EvaluationOutput = {
      ...output,
      scores: [
        ...output.scores,
        { criterionId: 'demo', score: Number.NaN, confidence: 0.7, evidence: [], rationale: 'ok', redFlags: [] },
      ],
    }
    expect(() => assertCompleteEvaluation(complete, rubric)).toThrow('non-numeric')
  })
})

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

describe('assertReadableScores', () => {
  test('accepts a delta that omits a criterion', () => {
    expect(() => assertReadableScores(output)).not.toThrow()
  })

  test('rejects a score that is not a number', () => {
    const unreadable: EvaluationOutput = {
      ...output,
      scores: [{ ...output.scores[0]!, score: Number.NaN }],
    }
    expect(() => assertReadableScores(unreadable)).toThrow('non-numeric')
  })
})

describe('revision merge', () => {
  const previous = normaliseEvaluation(
    {
      ...output,
      scores: [
        ...output.scores,
        { criterionId: 'demo', score: 70, confidence: 0.6, evidence: ['video:40s'], rationale: 'demo works', redFlags: [] },
      ],
    },
    {
      projectId: 'p1',
      agentId: 'e1',
      agentName: 'Impact & problem fit',
      model: 'runware:openai-gpt-6-luna',
      rubric,
    },
  )

  test('carries omitted criteria from the previous evaluation', () => {
    const merged = mergeRevisionOutput({ ...output, scores: [output.scores[0]!] }, previous)
    expect(merged.scores.map((score) => score.criterionId)).toEqual([' impact ', 'ai_tooling', 'technical_depth', 'demo'])
  })

  test('keeps a changed score and the previous values for the rest', () => {
    const revision = normaliseRevision(
      {
        ...output,
        scores: [{ criterionId: 'impact', score: 88, confidence: 0.9, evidence: ['repo:README.md'], rationale: 'stronger', redFlags: [] }],
      },
      {
        projectId: 'p1',
        agentId: 'e1',
        agentName: 'Impact & problem fit',
        model: 'runware:openai-gpt-6-luna',
        rubric,
      },
      previous,
    )
    expect(revision.scores.find((score) => score.criterionId === 'impact')?.score).toBe(88)
    expect(revision.scores.find((score) => score.criterionId === 'demo')?.score).toBe(70)
    expect(revision.redFlags).not.toContain('missing-criterion:demo')
  })
})
