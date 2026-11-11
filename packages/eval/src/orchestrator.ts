import { modelRefKey, type ModelRef } from '@verdict/providers'
import {
  buildConsensus,
  primaryTrack,
  projectTracks,
  rankProjects,
  verifierFinalScores,
  weightedOverall,
  type ProjectConsensus,
  type ProjectEvaluation,
  type ProjectEvidence,
  type ProjectInput,
  type ProjectRevision,
  type ProjectVerification,
  type RankedProject,
  type Report,
  type RunEvent,
  type RunEventType,
  type RunOptions,
  type RunUsage,
  type Rubric,
  type TrackRanking,
  type UsageByAgent,
  type UsageByStage,
  type UsageStage,
} from '@verdict/shared'
import { harvestProject } from '@verdict/harvest'
import { EVALUATORS, VERIFIERS } from './agents'
import { evaluateProject } from './evaluator'
import { rankTrack } from './ranking'
import { reviseEvaluation } from './revision'
import { verifyProject, verifyRanking } from './verifier'
import type { UsageTotals } from './structured'

export interface OrchestratorArgs {
  runId: string
  manifest: ProjectInput[]
  rubric: Rubric
  rulesText: string
  options: RunOptions
  evaluatorModels: ModelRef[]
  verifierModels: ModelRef[]
  onEvent: (event: RunEvent) => void
  signal?: AbortSignal
  /** Awaited at every step boundary while the user has the run paused. */
  waitForResume?: (signal?: AbortSignal) => Promise<void>
  warnings?: string[]
}

export interface OrchestratorResult {
  evidence: ProjectEvidence[]
  evaluations: ProjectEvaluation[]
  revisions: ProjectRevision[]
  consensus: ProjectConsensus[]
  verifications: ProjectVerification[]
  report: Report
  usage: UsageTotals
  warnings: string[]
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Run cancelled.')
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index]!, index)
    }
  })
  await Promise.all(lanes)
  return results
}

function emptyUsage(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, calls: 0 }
}

function addUsage(target: UsageTotals, addition: UsageTotals): void {
  target.inputTokens += addition.inputTokens
  target.outputTokens += addition.outputTokens
  target.calls += addition.calls
}

function pickModel(pool: ModelRef[], index: number, label: string): ModelRef {
  const model = pool[index % pool.length]
  if (!model) throw new Error(`No ${label} model is configured. Add one in the model selector or in the environment.`)
  return model
}

function failureEvaluation(projectId: string, agentId: string, agentName: string, model: string, rubric: Rubric, message: string): ProjectEvaluation {
  return {
    projectId,
    agentId,
    agentName,
    model,
    scores: rubric.criteria.map((criterion) => ({
      criterionId: criterion.id,
      score: rubric.scale.min,
      confidence: 0,
      evidence: [],
      rationale: `The evaluator failed: ${message}`,
      redFlags: ['agent-failure'],
    })),
    overall: 0,
    summary: 'Evaluation failed.',
    redFlags: ['agent-failure'],
  }
}

export async function runEvaluation(args: OrchestratorArgs): Promise<OrchestratorResult> {
  const { runId, manifest, rubric, rulesText, options, evaluatorModels, verifierModels, onEvent, signal, waitForResume } = args
  const warnings = [...(args.warnings ?? [])]
  const usage = emptyUsage()
  const usageByAgent = new Map<string, UsageByAgent>()
  const usageByStage = new Map<UsageStage, UsageTotals>()

  /** Add one call to the run total, its agent and its stage in one place. */
  const recordUsage = (
    stage: UsageStage,
    addition: UsageTotals,
    agent?: { id: string; name: string; role: UsageByAgent['role'] },
  ) => {
    addUsage(usage, addition)
    const stageTotals = usageByStage.get(stage) ?? emptyUsage()
    addUsage(stageTotals, addition)
    usageByStage.set(stage, stageTotals)
    if (!agent) return
    const key = `${agent.role}:${agent.id}`
    const entry = usageByAgent.get(key) ?? { agentId: agent.id, agentName: agent.name, role: agent.role, ...emptyUsage() }
    addUsage(entry, addition)
    usageByAgent.set(key, entry)
  }

  const emit = (type: RunEventType, partial: Omit<RunEvent, 'type' | 'runId' | 'at'> = {}) =>
    onEvent({ type, runId, at: new Date().toISOString(), ...partial })
  const log = (message: string) => emit('log', { message })

  /**
   * Step boundary: abort if cancelled, hold while paused, abort again if the
   * user cancelled while waiting.
   */
  const checkpoint = async (): Promise<void> => {
    throwIfAborted(signal)
    if (waitForResume) await waitForResume(signal)
    throwIfAborted(signal)
  }

  if (evaluatorModels.length === 0) throw new Error('No evaluator model is configured.')
  if (verifierModels.length === 0) throw new Error('No verifier model is configured.')

  const evaluators = EVALUATORS.slice(0, Math.max(1, rubric.consensus.evaluators))
  const verifiers = VERIFIERS.slice(0, Math.max(1, rubric.consensus.verifiers))

  // 1. Harvest
  await checkpoint()
  emit('stage', { message: 'harvesting' })
  const evidenceList = await mapLimit(manifest, options.concurrency, async (project) => {
    await checkpoint()
    emit('project', { projectId: project.id, message: 'harvesting', data: { name: project.name } })
    const evidence = await harvestProject(project, {
      maxVideoMinutes: options.maxVideoMinutes,
      frameIntervalSeconds: options.frameIntervalSeconds,
      signal,
      onLog: (message) => log(message),
    })
    emit('evidence', {
      projectId: project.id,
      message: 'harvested',
      data: {
        repoFiles: evidence.repo?.filesCount ?? 0,
        transcriptSegments: evidence.video?.transcript?.segments.length ?? 0,
        frames: evidence.video?.frames.length ?? 0,
        errors: evidence.errors,
      },
    })
    for (const error of evidence.errors) warnings.push(`${project.name}: ${error}`)
    return evidence
  })
  const evidenceMap = new Map(evidenceList.map((evidence) => [evidence.projectId, evidence]))

  // 2. Independent evaluation
  await checkpoint()
  emit('stage', { message: 'evaluating' })
  const evaluations: ProjectEvaluation[] = []
  await mapLimit(manifest, options.concurrency, async (project) => {
    await checkpoint()
    const evidence = evidenceMap.get(project.id) ?? { projectId: project.id, errors: ['No evidence.'] }
    const projectEvaluations = await Promise.all(
      evaluators.map(async (agent, index) => {
        const modelRef = pickModel(evaluatorModels, index, 'evaluator')
        try {
          const result = await evaluateProject({
            project,
            evidence,
            rubric,
            rulesText,
            agent,
            modelRef,
            temperature: options.temperature,
            signal,
          })
          recordUsage('evaluation', result.usage, { id: agent.id, name: agent.name, role: 'evaluator' })
          emit('evaluation', {
            projectId: project.id,
            message: `${agent.name} → ${result.evaluation.overall}`,
            data: result.evaluation,
          })
          return result.evaluation
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log(`[${project.name}] ${agent.name} failed: ${message}`)
          const fallback = failureEvaluation(project.id, agent.id, agent.name, modelRefKey(modelRef), rubric, message)
          emit('evaluation', { projectId: project.id, message: `${agent.name} failed`, data: fallback })
          return fallback
        }
      }),
    )
    evaluations.push(...projectEvaluations)
  })

  // 3. Cross-review
  await checkpoint()
  emit('stage', { message: 'reviewing' })
  const revisions: ProjectRevision[] = []
  await mapLimit(manifest, options.concurrency, async (project) => {
    await checkpoint()
    const evidence = evidenceMap.get(project.id) ?? { projectId: project.id, errors: ['No evidence.'] }
    const ownEvaluations = evaluations.filter((evaluation) => evaluation.projectId === project.id)
    const projectRevisions = await Promise.all(
      evaluators.map(async (agent, index) => {
        const own = ownEvaluations.find((evaluation) => evaluation.agentId === agent.id)
        if (!own || own.redFlags.includes('agent-failure')) {
          return { ...(own ?? failureEvaluation(project.id, agent.id, agent.name, 'n/a', rubric, 'no initial evaluation')), round: 2, changed: false } as ProjectRevision
        }
        const modelRef = pickModel(evaluatorModels, index, 'evaluator')
        try {
          const result = await reviseEvaluation({
            project,
            evidence,
            rubric,
            rulesText,
            agent,
            modelRef,
            temperature: options.temperature,
            own,
            all: ownEvaluations,
            round: 2,
            signal,
          })
          recordUsage('revision', result.usage, { id: agent.id, name: agent.name, role: 'evaluator' })
          emit('revision', {
            projectId: project.id,
            message: `${agent.name} revised${result.revision.changed ? '' : ' (unchanged)'}`,
            data: result.revision,
          })
          return result.revision
        } catch (error) {
          log(`[${project.name}] ${agent.name} revision failed: ${error instanceof Error ? error.message : String(error)}`)
          return { ...own, round: 2, changed: false } as ProjectRevision
        }
      }),
    )
    revisions.push(...projectRevisions)
  })

  // 4. Consensus
  await checkpoint()
  emit('stage', { message: 'consensus' })
  const consensus = manifest.map((project) => {
    const projectRevisions = revisions.filter((revision) => revision.projectId === project.id)
    const result = buildConsensus(project.id, projectRevisions.length > 0 ? projectRevisions : evaluations.filter((evaluation) => evaluation.projectId === project.id), rubric)
    emit('consensus', { projectId: project.id, message: `${project.name} → ${result.overall} (${result.status})`, data: result })
    if (result.status === 'escalated') warnings.push(`${project.name}: evaluator dispersion is ${result.dispersion} points; verifiers must arbitrate.`)
    return result
  })

  // 5. Comparative ranking pass
  await checkpoint()
  const tracks = groupByTrack(manifest)
  const comparativeOrders = new Map<string, string[]>()
  // Two lanes handle the tracks at once. A track is independent of the others,
  // so waiting for a slow track no longer delays the rest of the ranking.
  await mapLimit([...tracks.entries()], 2, async ([track, projects]) => {
    if (projects.length <= 1) {
      comparativeOrders.set(track, projects.map((project) => project.id))
      return
    }
    await checkpoint()
    log(`[${track}] comparative ranking with ${evaluatorModels.length} model(s).`)
    const result = await rankTrack({
      track,
      projects,
      consensus,
      evidence: evidenceMap,
      anchors: options.anchors,
      rubric,
      modelRefs: evaluatorModels,
      temperature: options.temperature,
      allProjects: manifest,
      allConsensus: consensus,
      showProvidedRanks: options.showRanksToAgents,
      onLog: log,
      signal,
    })
    recordUsage('ranking', result.usage)
    comparativeOrders.set(track, result.order)
  })

  // 6. Verification
  await checkpoint()
  emit('stage', { message: 'verifying' })
  const verifications: ProjectVerification[] = []
  await mapLimit(manifest, options.concurrency, async (project) => {
    await checkpoint()
    const evidence = evidenceMap.get(project.id) ?? { projectId: project.id, errors: ['No evidence.'] }
    const projectConsensus = consensus.find((entry) => entry.projectId === project.id)
    if (!projectConsensus) return
    const projectEvaluations = revisions.filter((revision) => revision.projectId === project.id)
    const projectVerifications = await Promise.all(
      verifiers.map(async (agent, index) => {
        const modelRef = pickModel(verifierModels, index, 'verifier')
        try {
          const result = await verifyProject({
            project,
            evidence,
            evaluations: projectEvaluations,
            consensus: projectConsensus,
            rubric,
            rulesText,
            agent,
            modelRef,
            temperature: options.temperature,
            signal,
          })
          recordUsage('verification', result.usage, { id: agent.id, name: agent.name, role: 'verifier' })
          emit('verification', {
            projectId: project.id,
            message: `${agent.name} → ${result.verification.finalOverall}`,
            data: result.verification,
          })
          return result.verification
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log(`[${project.name}] ${agent.name} failed: ${message}`)
          return {
            projectId: project.id,
            verifierId: agent.id,
            verifierName: agent.name,
            model: modelRefKey(modelRef),
            finalScores: Object.fromEntries(projectConsensus.criteria.map((criterion) => [criterion.criterionId, criterion.score])),
            finalOverall: projectConsensus.overall,
            adjustments: [],
            approved: false,
            notes: `Verifier failed: ${message}`,
            redFlags: ['verifier-failure'],
          } satisfies ProjectVerification
        }
      }),
    )
    verifications.push(...projectVerifications)
  })

  // 7. Final ranking and report
  const finalByTrack = new Map<string, RankedProject[]>()
  await mapLimit([...tracks.entries()], 2, async ([track, projects]) => {
    const projectVerifications = verifications.filter((verification) => projects.some((project) => project.id === verification.projectId))
    const rankingResult = await verifyRanking({
      track,
      projects,
      consensus,
      verifications: projectVerifications,
      evidence: evidenceMap,
      rubric,
      modelRefs: verifierModels,
      temperature: options.temperature,
      onLog: log,
      signal,
    })
    recordUsage('verifier_ranking', rankingResult.usage)
    const comparative = comparativeOrders.get(track) ?? []
    const finalScores = new Map<string, number>()
    for (const project of projects) {
      const own = projectVerifications.filter((verification) => verification.projectId === project.id)
      finalScores.set(project.id, own.length > 0 ? verifierFinalScores(own, rubric).overall : consensus.find((entry) => entry.projectId === project.id)?.overall ?? 0)
    }

    const ordered = [...projects].sort((left, right) => {
      const delta = (finalScores.get(right.id) ?? 0) - (finalScores.get(left.id) ?? 0)
      if (delta !== 0) return delta
      const leftRank = rankingResult.order.indexOf(left.id)
      const rightRank = rankingResult.order.indexOf(right.id)
      if (leftRank !== rightRank) return (leftRank < 0 ? Number.MAX_SAFE_INTEGER : leftRank) - (rightRank < 0 ? Number.MAX_SAFE_INTEGER : rightRank)
      return comparative.indexOf(left.id) - comparative.indexOf(right.id)
    })

    finalByTrack.set(
      track,
      ordered.map((project, index) => {
        const projectConsensus = consensus.find((entry) => entry.projectId === project.id)
        const rank = index + 1
        const hasProvidedRank = project.rank !== undefined && primaryTrack(project) === track
        return {
          projectId: project.id,
          name: project.name,
          track,
          rank,
          overall: finalScores.get(project.id) ?? 0,
          ...(hasProvidedRank ? { providedRank: project.rank } : {}),
          ...(hasProvidedRank ? { rankDelta: (project.rank as number) - rank } : {}),
          confidence: projectConsensus?.confidence ?? 0,
          status: projectConsensus?.status ?? 'escalated',
        } satisfies RankedProject
      }),
    )
  })

  const rankings: TrackRanking[] = [...finalByTrack.entries()].map(([track, entries]) => ({ track, entries }))
  const usageSummary: RunUsage = {
    total: { ...usage },
    byAgent: [...usageByAgent.values()]
      .map((entry) => ({ ...entry }))
      .sort((left, right) =>
        left.role === right.role ? left.agentName.localeCompare(right.agentName) : left.role.localeCompare(right.role),
      ),
    byStage: (['evaluation', 'revision', 'ranking', 'verification', 'verifier_ranking'] as const)
      .map((stage) => {
        const totals = usageByStage.get(stage)
        return totals ? ({ stage, ...totals } as UsageByStage) : null
      })
      .filter((entry): entry is UsageByStage => entry !== null),
  }
  const report: Report = {
    runId,
    createdAt: new Date().toISOString(),
    rubricName: rubric.name,
    models: {
      evaluators: [...new Set(evaluators.map((_, index) => modelRefKey(pickModel(evaluatorModels, index, 'evaluator'))))],
      verifiers: [...new Set(verifiers.map((_, index) => modelRefKey(pickModel(verifierModels, index, 'verifier'))))],
    },
    criteria: rubric.criteria.map((criterion) => ({ id: criterion.id, label: criterion.label, weight: criterion.weight })),
    rankings,
    projects: manifest.map((project) => {
      const projectConsensus = consensus.find((entry) => entry.projectId === project.id) ?? {
        projectId: project.id,
        criteria: [],
        overall: 0,
        dispersion: 0,
        confidence: 0,
        status: 'escalated' as const,
        disagreements: [],
      }
      const projectVerifications = verifications.filter((verification) => verification.projectId === project.id)
      const final = projectVerifications.length > 0 ? verifierFinalScores(projectVerifications, rubric) : { scores: Object.fromEntries(projectConsensus.criteria.map((criterion) => [criterion.criterionId, criterion.score])), overall: projectConsensus.overall }
      const evidence = evidenceMap.get(project.id)
      return {
        projectId: project.id,
        name: project.name,
        track: primaryTrack(project),
        consensus: projectConsensus,
        verifications: projectVerifications,
        finalScores: final.scores,
        finalOverall: final.overall,
        evidence: {
          repoFiles: evidence?.repo?.filesCount ?? 0,
          transcriptSegments: evidence?.video?.transcript?.segments.length ?? 0,
          frames: evidence?.video?.frames.length ?? 0,
          errors: evidence?.errors ?? [],
        },
      }
    }),
    usage: usageSummary,
    warnings,
  }

  emit('report', { message: 'report', data: report })
  return { evidence: evidenceList, evaluations, revisions, consensus, verifications, report, usage, warnings }
}

function groupByTrack(manifest: ProjectInput[]): Map<string, ProjectInput[]> {
  const groups = new Map<string, ProjectInput[]>()
  for (const project of manifest) {
    for (const track of projectTracks(project)) {
      const bucket = groups.get(track) ?? []
      bucket.push(project)
      groups.set(track, bucket)
    }
  }
  return groups
}

export { rankProjects, weightedOverall }
