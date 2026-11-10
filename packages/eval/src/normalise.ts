import { weightedOverall, type EvaluationOutput, type ProjectEvaluation, type Rubric, type RubricCriterion } from '@verdict/shared'

export interface NormaliseContext {
  projectId: string
  agentId: string
  agentName: string
  model: string
  rubric: Rubric
}

function clampScore(value: number, criterion: RubricCriterion, rubric: Rubric): number {
  const step = rubric.scale.step > 0 ? rubric.scale.step : 1
  const clamped = Math.min(rubric.scale.max, Math.max(rubric.scale.min, Number.isFinite(value) ? value : rubric.scale.min))
  return Math.round(clamped / step) * step
}

/**
 * Turn a model response into a complete evaluation: every rubric criterion is
 * present exactly once, scores are clamped to the scale, and missing criteria
 * are flagged instead of silently dropped.
 */
export function normaliseEvaluation(output: EvaluationOutput, context: NormaliseContext): ProjectEvaluation {
  const byId = new Map(output.scores.map((score) => [score.criterionId.trim().toLowerCase(), score]))
  const redFlags = new Set(output.redFlags.map((flag) => flag.trim()).filter(Boolean))

  const scores = context.rubric.criteria.map((criterion) => {
    const entry = byId.get(criterion.id.toLowerCase()) ?? byId.get(criterion.label.toLowerCase())
    if (!entry) {
      redFlags.add(`missing-criterion:${criterion.id}`)
      return {
        criterionId: criterion.id,
        score: context.rubric.scale.min,
        confidence: 0,
        evidence: [],
        rationale: 'The evaluator did not return this criterion.',
        redFlags: ['missing-criterion'],
      }
    }
    for (const flag of entry.redFlags) if (flag.trim()) redFlags.add(flag.trim())
    return {
      criterionId: criterion.id,
      score: clampScore(entry.score, criterion, context.rubric),
      confidence: Math.min(1, Math.max(0, entry.confidence)),
      evidence: [...new Set(entry.evidence.map((citation) => citation.trim()).filter(Boolean))],
      rationale: entry.rationale.trim() || 'No rationale returned.',
      redFlags: entry.redFlags.map((flag) => flag.trim()).filter(Boolean),
    }
  })

  const scoreMap = Object.fromEntries(scores.map((score) => [score.criterionId, score.score]))
  return {
    projectId: context.projectId,
    agentId: context.agentId,
    agentName: context.agentName,
    model: context.model,
    scores,
    overall: Math.round(weightedOverall(scoreMap, context.rubric) * 100) / 100,
    summary: output.summary.trim(),
    redFlags: [...redFlags],
  }
}
