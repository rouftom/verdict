import { createLanguageModel, modelRefKey, modelRefLabel, type ModelRef } from '@verdict/providers'
import {
  bordaCount,
  primaryTrack,
  rankingOutputSchema,
  scoreKey,
  type ProjectConsensus,
  type ProjectEvidence,
  type ProjectInput,
  type Rubric,
} from '@verdict/shared'
import { compactDossier } from './dossier'
import { rankingPrompt, rankingSystem } from './prompts'
import { generateStructured, type UsageTotals } from './structured'

export interface RankTrackArgs {
  track: string
  projects: ProjectInput[]
  consensus: ProjectConsensus[]
  evidence: Map<string, ProjectEvidence>
  anchors: string[]
  rubric: Rubric
  modelRefs: ModelRef[]
  temperature: number
  /** The whole manifest and consensus, so cross-track anchors can calibrate. */
  allProjects?: ProjectInput[]
  allConsensus?: ProjectConsensus[]
  /** When true, supplied ranks are shown to the ranking pass as context only. */
  showProvidedRanks?: boolean
  onLog?: (message: string) => void
  signal?: AbortSignal
}

export interface RankTrackResult {
  track: string
  order: string[]
  borda: Record<string, number>
  usage: UsageTotals
  failures: number
}

function normaliseOrder(order: string[], allowed: Set<string>, fallback: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of order) {
    if (allowed.has(id) && !seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  for (const id of fallback) {
    if (!seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  return result
}

/** Comparative pass: every evaluator model orders the track; Borda aggregates them. */
export async function rankTrack(args: RankTrackArgs): Promise<RankTrackResult> {
  const { track, projects, consensus, evidence, anchors, rubric, modelRefs, temperature, showProvidedRanks, onLog, signal } = args
  const allProjects = args.allProjects ?? projects
  const allConsensus = args.allConsensus ?? consensus
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, calls: 0 }
  const ids = new Set(projects.map((project) => project.id))
  const byId = new Map(consensus.map((entry) => [scoreKey(entry.projectId, entry.track), entry]))
  const lookup = (projectId: string): ProjectConsensus | undefined =>
    byId.get(scoreKey(projectId, track)) ?? byId.get(projectId)
  const allById = new Map(allConsensus.map((entry) => [scoreKey(entry.projectId, entry.track), entry]))
  const lookupAnyTrack = (projectId: string): ProjectConsensus | undefined => {
    const project = allProjects.find((entry) => entry.id === projectId)
    if (project) return allById.get(scoreKey(projectId, primaryTrack(project))) ?? allById.get(projectId)
    return allById.get(projectId)
  }
  const fallback = [...projects]
    .sort((left, right) => (lookup(right.id)?.overall ?? 0) - (lookup(left.id)?.overall ?? 0))
    .map((project) => project.id)

  if (projects.length <= 1) return { track, order: fallback, borda: {}, usage, failures: 0 }

  const packets = projects.map((project) => compactDossier(project, lookup(project.id), evidence.get(project.id) ?? { projectId: project.id, errors: [] }, rubric))
  const trackAnchors = anchors.filter((id) => ids.has(id))
  // An anchor in another track is still a calibration point: give its packet to
  // the ranking pass, but never put it in this track's order.
  const calibrationPackets = anchors
    .filter((id) => !ids.has(id))
    .map((id) => allProjects.find((project) => project.id === id))
    .filter((project): project is ProjectInput => Boolean(project))
    .map((project) => compactDossier(project, lookupAnyTrack(project.id), evidence.get(project.id) ?? { projectId: project.id, errors: [] }, rubric))
  // Ranks are shown to this pass only, after every criterion score is fixed.
  // A supplied rank belongs to the primary track; other tracks never see it.
  const suppliedRanks = showProvidedRanks
    ? projects
        .filter((project) => typeof project.rank === 'number' && primaryTrack(project) === track)
        .map((project) => ({ id: project.id, name: project.name, rank: project.rank as number }))
    : []
  const orders: string[][] = []
  let failures = 0

  // Every model orders the track independently. Running them together turns
  // the comparative pass from a serial chain into one round of calls; a slow
  // or failing model no longer delays the others.
  const outcomes = await Promise.all(
    modelRefs.map(async (modelRef) => {
      try {
        const result = await generateStructured({
          model: createLanguageModel(modelRef),
          modelRef,
          schema: rankingOutputSchema,
          system: rankingSystem(rubric),
          prompt: rankingPrompt(track, packets, trackAnchors, suppliedRanks, calibrationPackets),
          temperature,
          jsonContract: `{ "order": ["project-id", "..."], "rationale": "one sentence" }`,
          ...(signal ? { signal } : {}),
        })
        return { order: normaliseOrder(result.object.order, ids, fallback), usage: result.usage }
      } catch (error) {
        onLog?.(`[${track}] ranking model [${modelRefLabel(modelRef)}] failed: ${error instanceof Error ? error.message : String(error)}`)
        return null
      }
    }),
  )
  for (const outcome of outcomes) {
    if (!outcome) {
      failures += 1
      continue
    }
    usage.inputTokens += outcome.usage.inputTokens
    usage.outputTokens += outcome.usage.outputTokens
    usage.calls += outcome.usage.calls
    orders.push(outcome.order)
  }

  if (orders.length === 0) return { track, order: fallback, borda: {}, usage, failures }

  const borda = bordaCount(orders)
  const order = [...ids].sort((left, right) => {
    const delta = (borda[right] ?? 0) - (borda[left] ?? 0)
    if (delta !== 0) return delta
    return (lookup(right)?.overall ?? 0) - (lookup(left)?.overall ?? 0)
  })
  return { track, order, borda, usage, failures }
}
