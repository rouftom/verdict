import { weightedOverall, type EvaluationOutput, type ProjectEvaluation, type Rubric, type RubricCriterion } from '@verdict/shared'

export interface NormaliseContext {
  projectId: string
  /** Track this record scores. Empty on runs scored before per-track scoring. */
  track?: string
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
 * Reject scores that cannot be read as numbers. A quoted or malformed value
 * coerces to NaN, which normalisation would otherwise clamp to the scale
 * minimum and report as a real zero.
 */
export function assertReadableScores(output: EvaluationOutput): void {
  const unreadable = output.scores
    .filter((score) => !Number.isFinite(score.score) || !Number.isFinite(score.confidence))
    .map((score) => score.criterionId)
  if (unreadable.length > 0) {
    throw new Error(
      `The evaluation has non-numeric scores for: ${unreadable.join(', ')}. Return one number per score and confidence.`,
    )
  }
}

/**
 * Reject a structurally valid answer that omitted rubric criteria. The
 * structured generator then falls back to a correction round with the exact
 * missing ids, instead of silently turning every absent score into zero.
 */
export function assertCompleteEvaluation(output: EvaluationOutput, rubric: Rubric): void {
  const present = new Set(output.scores.map((score) => score.criterionId.trim().toLowerCase()))
  const missing = rubric.criteria
    .filter((criterion) => !present.has(criterion.id.toLowerCase()) && !present.has(criterion.label.toLowerCase()))
    .map((criterion) => criterion.id)
  if (missing.length > 0) {
    throw new Error(
      `The evaluation is missing rubric criteria in scores: ${missing.join(', ')}. Return exactly one score object per criterion.`,
    )
  }
  assertReadableScores(output)
}

/**
 * A revision is a delta: criteria the model left out keep their previous score
 * instead of failing the whole round or dropping to the scale minimum.
 */
export function mergeRevisionOutput(output: EvaluationOutput, previous: ProjectEvaluation): EvaluationOutput {
  const present = new Set(output.scores.map((score) => score.criterionId.trim().toLowerCase()))
  const carried = previous.scores
    .filter((score) => !present.has(score.criterionId.trim().toLowerCase()))
    .map((score) => ({ ...score, evidence: [...score.evidence], redFlags: [...score.redFlags] }))
  return { ...output, scores: [...output.scores, ...carried] }
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
    ...(context.track !== undefined ? { track: context.track } : {}),
    agentId: context.agentId,
    agentName: context.agentName,
    model: context.model,
    scores,
    overall: Math.round(weightedOverall(scoreMap, context.rubric) * 100) / 100,
    summary: output.summary.trim(),
    redFlags: [...redFlags],
  }
}

/**
 * Normalise a cross-review answer on top of the agent's own evaluation. The
 * model only has to return the criteria it actually changed; every omitted
 * criterion keeps its previous score, evidence and rationale.
 */
export function normaliseRevision(
  output: EvaluationOutput,
  context: NormaliseContext,
  previous: ProjectEvaluation,
): ProjectEvaluation {
  return normaliseEvaluation(mergeRevisionOutput(output, previous), context)
}

