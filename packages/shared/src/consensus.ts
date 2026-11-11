import type {
  ProjectConsensus,
  ProjectEvaluation,
  ProjectInput,
  ProjectVerification,
  RankedProject,
  Rubric,
  TrackRanking,
} from './types'
import { primaryTrack, projectTracks } from './tracks'

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0)
}

/** Median absolute deviation: a robust dispersion measure. */
export function mad(values: number[]): number {
  if (values.length === 0) return 0
  const center = median(values)
  return median(values.map((value) => Math.abs(value - center)))
}

/** Drop the highest and the lowest observation, then average the rest. */
export function trimmedMean(values: number[]): number {
  if (values.length <= 2) return mean(values)
  const sorted = [...values].sort((left, right) => left - right)
  return mean(sorted.slice(1, -1))
}

export function weightedOverall(scores: Record<string, number>, rubric: Rubric): number {
  const totalWeight = rubric.criteria.reduce((sum, criterion) => sum + Math.max(0, criterion.weight), 0)
  if (totalWeight <= 0) return mean(Object.values(scores))
  const weighted = rubric.criteria.reduce((sum, criterion) => sum + (scores[criterion.id] ?? rubric.scale.min) * Math.max(0, criterion.weight), 0)
  return weighted / totalWeight
}

/** Whether one criterion observation carries enough citations for the rubric. */
function isCited(citations: string[] | undefined, minimum: number): boolean {
  return (citations?.filter((citation) => citation.trim().length > 0).length ?? 0) >= minimum
}

/**
 * Weighted score over the criteria an evaluation actually supports. Uncited
 * observations are left out instead of falling back to the scale minimum, so a
 * missing citation can no longer pull an evaluator's overall down to zero.
 */
function citedOverall(evaluation: ProjectEvaluation, rubric: Rubric, requireEvidence: boolean, minimum: number): number {
  const usable = requireEvidence
    ? evaluation.scores.filter((score) => isCited(score.evidence, minimum))
    : evaluation.scores
  const pool = usable.length > 0 ? usable : evaluation.scores
  const weights = new Map(rubric.criteria.map((criterion) => [criterion.id, Math.max(0, criterion.weight)]))
  const totalWeight = pool.reduce((sum, score) => sum + (weights.get(score.criterionId) ?? 0), 0)
  if (totalWeight <= 0) return mean(pool.map((score) => score.score))
  return pool.reduce((sum, score) => sum + score.score * (weights.get(score.criterionId) ?? 0), 0) / totalWeight
}

/**
 * Build one project's consensus from the six independent evaluations.
 * Per criterion: trimmed mean and spread over the cited observations only.
 * Overall: weighted score of the consensus. Dispersion: MAD of the evaluators'
 * overall scores. A criterion spread above the tolerance escalates the project,
 * even when the overall dispersion is small.
 */
export function buildConsensus(projectId: string, evaluations: ProjectEvaluation[], rubric: Rubric): ProjectConsensus {
  const relevant = evaluations.filter((evaluation) => evaluation.projectId === projectId)
  const requireEvidence = rubric.consensus.requireEvidence
  const minimum = Math.max(0, Math.trunc(rubric.consensus.minEvidencePerCriterion))

  const criteria = rubric.criteria.map((criterion) => {
    const observations = relevant.flatMap((evaluation) => {
      const score = evaluation.scores.find((entry) => entry.criterionId === criterion.id)
      return score && typeof score.score === 'number' && Number.isFinite(score.score) ? [{ evaluation, score }] : []
    })
    const cited = requireEvidence
      ? observations.filter((observation) => isCited(observation.score.evidence, minimum))
      : observations
    // With no citation anywhere the requirement cannot discriminate: keep the
    // observations and let the verifier see the problem instead of zeroing all.
    const counted = cited.length > 0 ? cited : observations
    const values = counted.map((observation) => observation.score.score)
    const score = rubric.consensus.aggregation === 'mean' ? mean(values) : rubric.consensus.aggregation === 'median' ? median(values) : trimmedMean(values)
    const spread = values.length > 0 ? Math.max(...values) - Math.min(...values) : 0

    const excluded = observations
      .filter((observation) => cited.length > 0 && !cited.includes(observation))
      .map((observation) => `${observation.evaluation.agentName}: score excluded, no citation`)
    const outliers = counted
      .filter((observation) => Math.abs(observation.score.score - score) > rubric.consensus.tolerancePoints)
      .map((observation) => `${observation.evaluation.agentName}: ${observation.score.rationale ?? ''}`)
      .filter((note) => !note.endsWith(': '))

    return {
      criterionId: criterion.id,
      score: Math.round(score * 100) / 100,
      spread: Math.round(spread * 100) / 100,
      scores: values,
      notes: [...excluded, ...outliers].slice(0, 4),
    }
  })

  const consensusScores = Object.fromEntries(criteria.map((criterion) => [criterion.criterionId, criterion.score]))
  const overalls = relevant.map((evaluation) => citedOverall(evaluation, rubric, requireEvidence, minimum))
  const dispersion = mad(overalls)
  const span = Math.max(1, rubric.scale.max - rubric.scale.min)
  const disagreements = criteria.filter((criterion) => criterion.spread > rubric.consensus.tolerancePoints).map((criterion) => criterion.criterionId)
  const unresolved = dispersion > rubric.consensus.tolerancePoints || disagreements.length > 0

  return {
    projectId,
    criteria,
    overall: Math.round(weightedOverall(consensusScores, rubric) * 100) / 100,
    dispersion: Math.round(dispersion * 100) / 100,
    confidence: Math.round(Math.min(0.95, Math.max(0.3, 1 - dispersion / span)) * 100) / 100,
    status: unresolved && rubric.consensus.onUnresolved === 'escalate' ? 'escalated' : 'consensus',
    disagreements,
  }
}

function compareByRubric(left: ProjectConsensus, right: ProjectConsensus, rubric: Rubric): number {
  if (right.overall !== left.overall) return right.overall - left.overall
  for (const criterionId of rubric.ranking.tieBreakers) {
    const leftScore = left.criteria.find((criterion) => criterion.criterionId === criterionId)?.score ?? 0
    const rightScore = right.criteria.find((criterion) => criterion.criterionId === criterionId)?.score ?? 0
    if (rightScore !== leftScore) return rightScore - leftScore
  }
  return 0
}

/** Rank inside each track. Provided ranks are only used for the delta, never to sort. */
export function rankProjects(
  projects: ProjectInput[],
  consensus: ProjectConsensus[],
  rubric: Rubric,
  options: { scope?: 'track' | 'global' } = {},
): TrackRanking[] {
  const scope = options.scope ?? rubric.ranking.scope
  const byId = new Map(consensus.map((entry) => [entry.projectId, entry]))
  const groups = new Map<string, ProjectInput[]>()
  for (const project of projects) {
    const keys = scope === 'global' ? ['all'] : projectTracks(project)
    for (const key of keys) {
      const bucket = groups.get(key) ?? []
      bucket.push(project)
      groups.set(key, bucket)
    }
  }

  return [...groups.entries()].map(([track, entries]) => {
    const sorted = [...entries].sort((left, right) => {
      const leftConsensus = byId.get(left.id)
      const rightConsensus = byId.get(right.id)
      if (!leftConsensus || !rightConsensus) return 0
      return compareByRubric(leftConsensus, rightConsensus, rubric)
    })

    const ranked: RankedProject[] = sorted.map((project, index) => {
      const projectConsensus = byId.get(project.id)
      const rank = index + 1
      // A supplied rank belongs to the primary track only; award and secondary
      // tracks are ranked from the scores alone.
      const hasProvidedRank = project.rank !== undefined && primaryTrack(project) === track
      return {
        projectId: project.id,
        name: project.name,
        track,
        rank,
        overall: projectConsensus?.overall ?? 0,
        ...(hasProvidedRank ? { providedRank: project.rank } : {}),
        ...(hasProvidedRank ? { rankDelta: (project.rank as number) - rank } : {}),
        confidence: projectConsensus?.confidence ?? 0,
        status: projectConsensus?.status ?? 'escalated',
      }
    })

    return { track, entries: ranked }
  })
}

/** Average the verifiers' final scores per criterion, then recompute the overall. */
export function verifierFinalScores(
  verifications: ProjectVerification[],
  rubric: Rubric,
): { scores: Record<string, number>; overall: number } {
  const scores: Record<string, number> = {}
  for (const criterion of rubric.criteria) {
    const values = verifications
      .map((verification) => verification.finalScores[criterion.id])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    scores[criterion.id] = Math.round(mean(values) * 100) / 100
  }
  return { scores, overall: Math.round(weightedOverall(scores, rubric) * 100) / 100 }
}

/** Borda count over ordinal rankings: first place gets the most points. */
export function bordaCount(orders: string[][]): Record<string, number> {
  const scores: Record<string, number> = {}
  for (const order of orders) {
    const length = order.length
    order.forEach((projectId, index) => {
      scores[projectId] = (scores[projectId] ?? 0) + (length - index)
    })
  }
  return scores
}
