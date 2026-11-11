import { createLanguageModel, modelRefKey, type ModelRef } from '@verdict/providers'
import {
  bordaCount,
  rankingOutputSchema,
  verificationOutputSchema,
  weightedOverall,
  type ProjectConsensus,
  type ProjectEvaluation,
  type ProjectEvidence,
  type ProjectInput,
  type ProjectVerification,
  type Rubric,
} from '@verdict/shared'
import type { AgentDefinition } from './agents'
import { buildDossier, compactDossier } from './dossier'
import { verifierPrompt, verifierRankingPrompt, verifierSystem } from './prompts'
import { generateStructured, type UsageTotals } from './structured'

function clamp(value: number, rubric: Rubric): number {
  const step = rubric.scale.step > 0 ? rubric.scale.step : 1
  const bounded = Math.min(rubric.scale.max, Math.max(rubric.scale.min, Number.isFinite(value) ? value : rubric.scale.min))
  return Math.round(bounded / step) * step
}

export interface VerifyProjectArgs {
  project: ProjectInput
  evidence: ProjectEvidence
  evaluations: ProjectEvaluation[]
  consensus: ProjectConsensus
  rubric: Rubric
  rulesText: string
  agent: AgentDefinition
  modelRef: ModelRef
  temperature: number
  signal?: AbortSignal
}

export async function verifyProject(args: VerifyProjectArgs): Promise<{ verification: ProjectVerification; usage: UsageTotals }> {
  const { project, evidence, evaluations, consensus, rubric, rulesText, agent, modelRef, temperature, signal } = args
  const result = await generateStructured({
    model: createLanguageModel(modelRef),
    modelRef,
    schema: verificationOutputSchema,
    system: verifierSystem(agent, rubric, rulesText),
    prompt: verifierPrompt(project, buildDossier(project, evidence), evaluations, consensus),
    temperature,
    jsonContract: `{
  "projectId": "${project.id}",
  "finalScores": { "impact": 0, "other-criterion": 0 },
  "adjustments": [{ "criterionId": "id", "from": 0, "to": 0, "reason": "why" }],
  "approved": true,
  "notes": "text",
  "redFlags": [],
  "ranking": ["project-id"]
}`,
    ...(signal ? { signal } : {}),
    ...(project.youtube ? { videoUrl: project.youtube } : {}),
  })

  const output = result.object
  const limit = rubric.consensus.verifierAdjustmentLimit
  const adjustments: ProjectVerification['adjustments'] = []
  const finalScores: Record<string, number> = {}

  for (const criterion of rubric.criteria) {
    const consensusScore = consensus.criteria.find((entry) => entry.criterionId === criterion.id)?.score ?? rubric.scale.min
    const proposed = clamp(Number(output.finalScores[criterion.id] ?? consensusScore), rubric)
    const bounded = Math.min(consensusScore + limit, Math.max(consensusScore - limit, proposed))
    finalScores[criterion.id] = Math.round(bounded * 100) / 100
    if (Math.abs(bounded - consensusScore) >= 0.5) {
      adjustments.push({
        criterionId: criterion.id,
        from: consensusScore,
        to: Math.round(bounded * 100) / 100,
        reason: output.adjustments.find((entry) => entry.criterionId === criterion.id)?.reason ?? 'Verifier adjustment.',
      })
    }
  }

  return {
    verification: {
      projectId: project.id,
      verifierId: agent.id,
      verifierName: agent.name,
      model: modelRefKey(modelRef),
      finalScores,
      finalOverall: Math.round(weightedOverall(finalScores, rubric) * 100) / 100,
      adjustments,
      approved: output.approved,
      notes: output.notes,
      redFlags: output.redFlags,
    },
    usage: result.usage,
  }
}

export interface VerifyRankingArgs {
  track: string
  projects: ProjectInput[]
  consensus: ProjectConsensus[]
  verifications: ProjectVerification[]
  evidence: Map<string, ProjectEvidence>
  rubric: Rubric
  modelRefs: ModelRef[]
  temperature: number
  onLog?: (message: string) => void
  signal?: AbortSignal
}

export interface VerifyRankingResult {
  track: string
  order: string[]
  borda: Record<string, number>
  usage: UsageTotals
  failures: number
}

/** Each verifier orders the track from the verified scores; Borda merges them. */
export async function verifyRanking(args: VerifyRankingArgs): Promise<VerifyRankingResult> {
  const { track, projects, consensus, verifications, evidence, rubric, modelRefs, temperature, onLog, signal } = args
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, calls: 0 }
  const ids = new Set(projects.map((project) => project.id))
  const byId = new Map(consensus.map((entry) => [entry.projectId, entry]))
  const fallback = [...projects]
    .sort((left, right) => (byId.get(right.id)?.overall ?? 0) - (byId.get(left.id)?.overall ?? 0))
    .map((project) => project.id)
  if (projects.length <= 1) return { track, order: fallback, borda: {}, usage, failures: 0 }

  const packets = projects.map((project) => compactDossier(project, byId.get(project.id), evidence.get(project.id) ?? { projectId: project.id, errors: [] }, rubric))
  const scoreLines = projects.map((project) => {
    const projectVerifications = verifications.filter((verification) => verification.projectId === project.id)
    return `${project.id} (${project.name}): ${projectVerifications.map((verification) => `${verification.verifierName} overall ${verification.finalOverall}`).join(' · ')}`
  })
  const orders: string[][] = []
  let failures = 0

  for (const modelRef of modelRefs) {
    try {
      const result = await generateStructured({
        model: createLanguageModel(modelRef),
        modelRef,
        schema: rankingOutputSchema,
        system: `You verify the final ranking of one track. Use the verified scores and the evidence packets. Return every project id exactly once, best first. Never use a supplied rank.`,
        prompt: verifierRankingPrompt(track, packets, scoreLines.join('\n')),
        temperature,
        jsonContract: `{ "order": ["project-id"], "rationale": "one sentence" }`,
        ...(signal ? { signal } : {}),
      })
      usage.inputTokens += result.usage.inputTokens
      usage.outputTokens += result.usage.outputTokens
      usage.calls += 1
      const seen = new Set<string>()
      const order: string[] = []
      for (const id of result.object.order) {
        if (ids.has(id) && !seen.has(id)) {
          seen.add(id)
          order.push(id)
        }
      }
      for (const id of fallback) if (!seen.has(id)) order.push(id)
      orders.push(order)
    } catch (error) {
      failures += 1
      onLog?.(`[${track}] verifier ranking ${modelRefKey(modelRef)} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (orders.length === 0) return { track, order: fallback, borda: {}, usage, failures }
  const borda = bordaCount(orders)
  const order = [...ids].sort((left, right) => (borda[right] ?? 0) - (borda[left] ?? 0))
  return { track, order, borda, usage, failures }
}
