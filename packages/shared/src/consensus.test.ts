import { describe, expect, test } from 'bun:test'
import { DEFAULT_RUBRIC } from './default-rubric'
import { buildConsensus } from './consensus'
import type { CriterionScore, ProjectEvaluation, Rubric } from './types'

/** Two equal-weight criteria make a disagreement test easy to reason about. */
const RUBRIC: Rubric = {
  ...DEFAULT_RUBRIC,
  criteria: [
    { ...DEFAULT_RUBRIC.criteria[0]!, weight: 0.5 },
    { ...DEFAULT_RUBRIC.criteria[1]!, weight: 0.5 },
  ],
}

function score(criterionId: string, value: number, evidence: string[] = ['repo:README.md']): CriterionScore {
  return {
    criterionId,
    score: value,
    confidence: 0.8,
    evidence,
    rationale: `${criterionId} rationale`,
    redFlags: [],
  }
}

function evaluation(agentId: string, scores: CriterionScore[]): ProjectEvaluation {
  const total = scores.reduce((sum, entry) => sum + entry.score, 0)
  return {
    projectId: 'p1',
    agentId,
    agentName: agentId,
    model: 'test/model',
    scores,
    overall: scores.length > 0 ? total / scores.length : 0,
    summary: 'summary',
    redFlags: [],
  }
}

describe('consensus evidence requirement', () => {
  test('an uncited zero score no longer drags the criterion down', () => {
    const consensus = buildConsensus(
      'p1',
      [
        evaluation('e1', [score('impact', 80), score('ai_tooling', 80)]),
        evaluation('e2', [score('impact', 80), score('ai_tooling', 80)]),
        evaluation('e3', [score('impact', 0, []), score('ai_tooling', 80)]),
      ],
      RUBRIC,
    )

    const impact = consensus.criteria.find((criterion) => criterion.criterionId === 'impact')
    expect(impact?.score).toBe(80)
    expect(impact?.scores).toEqual([80, 80])
    expect(impact?.notes.some((note) => note.includes('score excluded, no citation'))).toBe(true)
  })

  test('the overall of an evaluator ignores its uncited criteria', () => {
    const consensus = buildConsensus(
      'p1',
      [
        evaluation('e1', [score('impact', 90), score('ai_tooling', 90)]),
        evaluation('e2', [score('impact', 90), score('ai_tooling', 0, [])]),
      ],
      RUBRIC,
    )

    // e2 is judged on impact alone: 90, not (90 + 0) / 2.
    expect(consensus.dispersion).toBe(0)
  })

  test('keeps every score when no evaluation cites anything', () => {
    const consensus = buildConsensus(
      'p1',
      [
        evaluation('e1', [score('impact', 60, []), score('ai_tooling', 60, [])]),
        evaluation('e2', [score('impact', 80, []), score('ai_tooling', 80, [])]),
      ],
      RUBRIC,
    )

    expect(consensus.criteria[0]?.score).toBe(70)
    expect(consensus.criteria[0]?.scores).toEqual([60, 80])
  })

  test('a rubric without the requirement counts every observation', () => {
    const rubric: Rubric = {
      ...RUBRIC,
      consensus: { ...RUBRIC.consensus, requireEvidence: false },
    }
    const consensus = buildConsensus(
      'p1',
      [
        evaluation('e1', [score('impact', 80), score('ai_tooling', 80)]),
        evaluation('e2', [score('impact', 0, []), score('ai_tooling', 80)]),
      ],
      rubric,
    )

    expect(consensus.criteria[0]?.score).toBe(40)
  })
})

describe('consensus disagreement', () => {
  test('a criterion spread above tolerance escalates even when overalls agree', () => {
    const consensus = buildConsensus(
      'p1',
      [
        evaluation('e1', [score('impact', 100), score('ai_tooling', 0)]),
        evaluation('e2', [score('impact', 0), score('ai_tooling', 100)]),
      ],
      RUBRIC,
    )

    // Both evaluators average 50, so the overall dispersion is zero.
    expect(consensus.dispersion).toBe(0)
    expect(consensus.disagreements).toEqual(['impact', 'ai_tooling'])
    expect(consensus.status).toBe('escalated')
  })

  test('onUnresolved=average keeps the consensus status', () => {
    const rubric: Rubric = {
      ...RUBRIC,
      consensus: { ...RUBRIC.consensus, onUnresolved: 'average' },
    }
    const consensus = buildConsensus(
      'p1',
      [
        evaluation('e1', [score('impact', 100), score('ai_tooling', 0)]),
        evaluation('e2', [score('impact', 0), score('ai_tooling', 100)]),
      ],
      rubric,
    )

    expect(consensus.status).toBe('consensus')
  })

  test('agreement below tolerance stays a consensus', () => {
    const consensus = buildConsensus(
      'p1',
      [
        evaluation('e1', [score('impact', 80), score('ai_tooling', 80)]),
        evaluation('e2', [score('impact', 84), score('ai_tooling', 82)]),
      ],
      RUBRIC,
    )

    expect(consensus.disagreements).toEqual([])
    expect(consensus.status).toBe('consensus')
  })
})
