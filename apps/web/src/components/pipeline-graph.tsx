'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { Badge, Popover, PopoverAnchor, PopoverContent, cn } from '@verdict/ui'
import {
  Activity,
  CheckCircle2,
  Circle,
  Flag,
  Loader2,
  Pause,
  ShieldCheck,
  UserRound,
  XCircle,
} from 'lucide-react'
import type {
  AgentInfo,
  ModelRef,
  ProjectEvaluation,
  ProjectRevision,
  ProjectVerification,
  RunEvent,
  RunStatus,
} from '@verdict/shared'
import { agentTimings, durationOf, stageTimings, type Timing } from '@/lib/run-timeline'

type StageStatus = 'idle' | 'active' | 'done' | 'error'

interface StageData extends Record<string, unknown> {
  title: string
  detail: string
  status: StageStatus
  duration?: string
}

export interface CriterionMeta {
  id: string
  label: string
}

interface AgentSummary {
  agent: AgentInfo
  role: 'evaluator' | 'verifier'
  model?: ModelRef
  status: StageStatus
  evaluation?: ProjectEvaluation
  revision?: ProjectRevision
  verification?: ProjectVerification
  count: number
}

type AgentData = AgentSummary &
  Record<string, unknown> & {
    criteria: CriterionMeta[]
    projectName?: string
    duration?: string
  }

/** Tick once a second only while the run is live, so a finished graph stays still. */
function useNow(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    setNow(Date.now())
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

function StatusIcon({ status, className }: { status: StageStatus; className?: string }) {
  if (status === 'done') return <CheckCircle2 className={cn('h-3.5 w-3.5 text-emerald-500', className)} />
  if (status === 'active') return <Loader2 className={cn('h-3.5 w-3.5 animate-spin text-brand-primary', className)} />
  if (status === 'error') return <XCircle className={cn('h-3.5 w-3.5 text-destructive', className)} />
  return <Circle className={cn('h-3.5 w-3.5 text-muted-foreground/50', className)} />
}

function StageNode({ data }: NodeProps) {
  const stage = data as StageData
  return (
    <div
      className={cn(
        'w-[172px] rounded-lg border bg-card px-3 py-2 shadow-sm transition-colors',
        stage.status === 'active' && 'border-brand-primary ring-2 ring-brand-primary/20',
        stage.status === 'done' && 'border-emerald-500/40',
        stage.status === 'error' && 'border-destructive/50',
        stage.status === 'idle' && 'border-border opacity-70',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-border" />
      <div className="flex items-center gap-1.5">
        <StatusIcon status={stage.status} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{stage.title}</span>
        {stage.duration ? (
          <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground">{stage.duration}</span>
        ) : null}
      </div>
      <p className="mt-0.5 truncate pl-5 text-[10px] leading-tight text-muted-foreground">{stage.detail}</p>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-border" />
    </div>
  )
}

function scoreClass(score: number): string {
  if (score >= 75) return 'text-emerald-600 dark:text-emerald-400'
  if (score >= 50) return 'text-amber-600 dark:text-amber-400'
  return 'text-destructive'
}

function modelName(model: ModelRef | undefined, notSet: string): string {
  return model ? model.model : notSet
}

function AgentCard({ data }: { data: AgentData }) {
  const { t } = useTranslation()
  const latest = data.revision ?? data.evaluation
  const criteriaScores = React.useMemo(() => {
    const map = new Map<string, { score: number; confidence: number; rationale?: string }>()
    if (latest) {
      for (const entry of latest.scores) {
        map.set(entry.criterionId, { score: entry.score, confidence: entry.confidence, rationale: entry.rationale })
      }
    }
    if (data.verification) {
      for (const [criterionId, score] of Object.entries(data.verification.finalScores)) {
        const previous = map.get(criterionId)
        map.set(criterionId, { score, confidence: previous?.confidence ?? 1, rationale: previous?.rationale })
      }
    }
    return map
  }, [data.verification, latest])

  const overall = data.verification?.finalOverall ?? latest?.overall
  const confidence =
    latest && latest.scores.length > 0
      ? latest.scores.reduce((sum, entry) => sum + entry.confidence, 0) / latest.scores.length
      : undefined
  const redFlags = data.verification?.redFlags ?? latest?.redFlags ?? []
  const summary = data.verification?.notes || latest?.summary || ''

  return (
    <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-primary/10 text-brand-primary">
          {data.role === 'evaluator' ? <UserRound className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold leading-tight">
            {t(`agents.${data.agent.id}.name`, { defaultValue: data.agent.name })}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {t(`agents.${data.agent.id}.lens`, { defaultValue: data.agent.lens })}
          </p>
        </div>
        <Badge tone={data.status === 'done' ? 'success' : data.status === 'active' ? 'brand' : data.status === 'error' ? 'danger' : 'neutral'}>
          {t(`role.${data.role}`)}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral" className="max-w-full truncate font-mono text-[10px]">
          {modelName(data.model, t('pipeline.modelNotSet'))}
        </Badge>
        {data.model?.reasoningEffort ? (
          <Badge tone="brand" className="text-[10px]">
            {t('pipeline.effort', { effort: data.model.reasoningEffort })}
          </Badge>
        ) : null}
        {data.duration ? (
          <Badge tone="neutral" className="font-mono text-[10px] tabular-nums">
            {data.duration}
          </Badge>
        ) : null}
        {data.revision ? (
          <Badge tone="warning" className="text-[10px]">
            {t('pipeline.revised', { round: data.revision.round })}
          </Badge>
        ) : null}
        {data.verification ? (
          <Badge tone={data.verification.approved ? 'success' : 'danger'} className="text-[10px]">
            {data.verification.approved ? t('pipeline.approved') : t('pipeline.flagged')}
          </Badge>
        ) : null}
      </div>

      <p className="text-[10px] leading-tight text-muted-foreground">
        {t(`agents.${data.agent.id}.focus`, { defaultValue: data.agent.focus })}
      </p>

      {overall !== undefined ? (
        <>
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] text-muted-foreground">{data.projectName ?? t('pipeline.latestProject')}</p>
              <p className="text-[9px] text-muted-foreground">
                {data.verification
                  ? t('pipeline.verifierFinalScore')
                  : confidence !== undefined
                    ? t('pipeline.confidence', { value: Math.round(confidence * 100) })
                    : t('pipeline.evaluatorScore')}
              </p>
            </div>
            <span className={cn('text-xl font-bold tabular-nums', scoreClass(overall))}>{overall.toFixed(1)}</span>
          </div>

          <div className="flex flex-col gap-1">
            {data.criteria.map((criterion) => {
              const entry = criteriaScores.get(criterion.id)
              return (
                <div key={criterion.id} className="flex items-center gap-2 text-[10px]">
                  <span className="min-w-0 flex-1 truncate">{criterion.label}</span>
                  <span className={cn('w-8 text-right font-semibold tabular-nums', entry ? scoreClass(entry.score) : 'text-muted-foreground')}>
                    {entry ? entry.score.toFixed(0) : '-'}
                  </span>
                </div>
              )
            })}
          </div>

          {summary ? (
            <div className="rounded-md border border-border bg-muted/20 p-2">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{t('pipeline.synthesis')}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-foreground">{summary}</p>
            </div>
          ) : null}

          {redFlags.length > 0 ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
              <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-destructive">
                <Flag className="h-2.5 w-2.5" /> {t('pipeline.redFlags')}
              </p>
              <ul className="mt-0.5 list-inside list-disc text-[10px] leading-snug text-muted-foreground">
                {redFlags.slice(0, 6).map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.verification && data.verification.adjustments.length > 0 ? (
            <div className="rounded-md border border-border p-2">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{t('pipeline.adjustments')}</p>
              <ul className="mt-0.5 list-inside list-disc text-[10px] leading-snug text-muted-foreground">
                {data.verification.adjustments.map((adjustment) => (
                  <li key={adjustment.criterionId}>
                    {adjustment.criterionId}: {adjustment.from} → {adjustment.to}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className="rounded-md border border-dashed border-border bg-muted/20 p-2 text-[10px] text-muted-foreground">
          {t('pipeline.waiting')}
        </p>
      )}

      <p className="flex items-center gap-1 text-[9px] text-muted-foreground">
        <Activity className="h-2.5 w-2.5" />
        {t('pipeline.resultCount', { count: data.count })}
      </p>
    </div>
  )
}

/** Only one agent card may stay open at a time, so a second click swaps it. */
const AgentPopoverContext = React.createContext<{
  openId: string | null
  setOpenId: (id: string | null) => void
}>({ openId: null, setOpenId: () => {} })

function AgentNode({ data }: NodeProps) {
  const { t } = useTranslation()
  const agent = data as AgentData
  const latest = agent.revision ?? agent.evaluation
  const overall = agent.verification?.finalOverall ?? latest?.overall
  const popover = React.useContext(AgentPopoverContext)
  const open = popover.openId === agent.agent.id
  return (
    <Popover open={open} onOpenChange={(next) => popover.setOpenId(next ? agent.agent.id : null)}>
      {/*
        An anchor instead of a trigger: React Flow swallows the click on a node
        before Radix's toggle sees it, so the popover opened and closed in the
        same gesture. The popover stays controlled and opens after the click.
      */}
      <PopoverAnchor asChild>
        <button
          type="button"
          title={t(`agents.${agent.agent.id}.name`, { defaultValue: agent.agent.name })}
          aria-expanded={open}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            // Open after the gesture: mounting the dismissable layer during the
            // same click makes Radix treat that click as an outside press and
            // close the card immediately.
            window.setTimeout(() => popover.setOpenId(open ? null : agent.agent.id), 0)
          }}
          className={cn(
            'nodrag nopan cursor-pointer w-[172px] rounded-lg border bg-card px-2 py-1.5 text-left shadow-sm transition-colors',
            'hover:border-brand-primary/60 hover:bg-brand-primary/5',
            agent.status === 'active' && 'border-brand-primary ring-2 ring-brand-primary/20',
            agent.status === 'done' && 'border-emerald-500/40',
            agent.status === 'error' && 'border-destructive/50',
            agent.status === 'idle' && 'border-border opacity-80',
          )}
        >
          <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-border" />
          <div className="flex items-center gap-1.5">
            <StatusIcon status={agent.status} className="h-3 w-3" />
            <span className="truncate text-[11px] font-semibold">
              {t(`agents.${agent.agent.id}.name`, { defaultValue: agent.agent.name })}
            </span>
            {overall !== undefined ? (
              <span className={cn('ml-auto text-[10px] font-bold tabular-nums', scoreClass(overall))}>{overall.toFixed(1)}</span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-1 pl-[18px]">
            <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted-foreground">
              {modelName(agent.model, t('pipeline.modelNotSet'))}
            </span>
            {agent.duration ? (
              <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground">{agent.duration}</span>
            ) : null}
            {agent.count > 1 ? <span className="text-[9px] tabular-nums text-muted-foreground">×{agent.count}</span> : null}
          </div>
          <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-border" />
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="z-[1000] w-[320px] p-2.5"
      >
        <AgentCard data={agent} />
      </PopoverContent>
    </Popover>
  )
}

const nodeTypes = { stage: StageNode, agent: AgentNode }

const STAGES = [
  { id: 'harvest', titleKey: 'pipeline.harvest', detailKey: 'pipeline.harvestDetail' },
  { id: 'review', titleKey: 'pipeline.review', detailKey: 'pipeline.reviewDetail' },
  { id: 'consensus', titleKey: 'pipeline.consensus', detailKey: 'pipeline.consensusDetail' },
  { id: 'rank', titleKey: 'pipeline.rank', detailKey: 'pipeline.rankDetail' },
  { id: 'report', titleKey: 'pipeline.report', detailKey: 'pipeline.reportDetail' },
] as const

type Phase = 'before' | 'active' | 'after'

const ORDER: RunStatus[] = ['queued', 'parsing', 'harvesting', 'evaluating', 'reviewing', 'consensus', 'verifying', 'done']

function phaseOf(stage: 'evaluate' | 'review' | 'verify', status?: RunStatus): Phase {
  if (!status || status === 'failed' || status === 'cancelled') return 'before'
  const target = stage === 'evaluate' ? ORDER.indexOf('evaluating') : stage === 'review' ? ORDER.indexOf('reviewing') : ORDER.indexOf('verifying')
  const current = ORDER.indexOf(status)
  if (current === target) return 'active'
  return current > target ? 'after' : 'before'
}

function statusIndex(status: RunStatus | undefined): number {
  switch (status) {
    case 'queued':
    case 'parsing':
      return -1
    case 'harvesting':
      return 0
    case 'evaluating':
      return 1
    case 'reviewing':
      return 2
    case 'consensus':
      return 3
    case 'verifying':
      return 4
    case 'done':
      return 5
    default:
      return -1
  }
}

function latestFor<T extends { projectId: string }>(items: T[], selectedProjectId?: string): T | undefined {
  if (selectedProjectId) {
    const selected = items.find((entry) => entry.projectId === selectedProjectId)
    if (selected) return selected
  }
  return items[items.length - 1]
}

function summariseAgents(
  pool: AgentInfo[],
  role: 'evaluator' | 'verifier',
  models: ModelRef[],
  evaluations: ProjectEvaluation[],
  revisions: ProjectRevision[],
  verifications: ProjectVerification[],
  current: RunStatus | undefined,
  failed: boolean,
  selectedProjectId?: string,
): AgentSummary[] {
  return pool.map((agent, index) => {
    const ownEvaluations =
      role === 'evaluator' ? evaluations.filter((entry) => entry.agentId === agent.id) : []
    const ownRevisions = role === 'evaluator' ? revisions.filter((entry) => entry.agentId === agent.id) : []
    const ownVerifications =
      role === 'verifier' ? verifications.filter((entry) => entry.verifierId === agent.id) : []
    const evaluation = latestFor(ownEvaluations, selectedProjectId)
    const revision = latestFor(ownRevisions, selectedProjectId)
    const verification = latestFor(ownVerifications, selectedProjectId)
    const hasResult = role === 'evaluator' ? Boolean(evaluation) : Boolean(verification)
    // An agent is busy until its own result for the *current* pass arrives, so
    // the spinner keeps turning during the revision round instead of freezing
    // on the first evaluation.
    let status: StageStatus = 'idle'
    if (failed) status = hasResult ? 'done' : 'error'
    else if (current === 'done') status = hasResult ? 'done' : 'idle'
    else if (current === 'evaluating') status = role === 'evaluator' ? (evaluation ? 'done' : 'active') : 'idle'
    else if (current === 'reviewing') status = role === 'evaluator' ? (revision ? 'done' : 'active') : 'done'
    else if (current === 'verifying') status = role === 'verifier' ? (verification ? 'done' : 'active') : 'done'
    else if (current === 'consensus') status = hasResult ? 'done' : 'idle'
    return {
      agent,
      role,
      model: models[index],
      status,
      ...(evaluation ? { evaluation } : {}),
      ...(revision ? { revision } : {}),
      ...(verification ? { verification } : {}),
      count: role === 'evaluator' ? ownEvaluations.length : ownVerifications.length,
    }
  })
}

export interface PipelineGraphProps {
  status?: RunStatus
  evaluations: ProjectEvaluation[]
  revisions: ProjectRevision[]
  verifications: ProjectVerification[]
  agents?: { evaluators: AgentInfo[]; verifiers: AgentInfo[] }
  evaluatorModels: ModelRef[]
  verifierModels: ModelRef[]
  criteria?: CriterionMeta[]
  projects?: { id: string; name: string }[]
  selectedProjectId?: string
  hasReport: boolean
  failed?: boolean
  /** The streamed events, used for live stage and agent durations. */
  events?: RunEvent[]
  /** The agent pool is still loading: show shimmer placeholders instead of an empty graph. */
  loading?: boolean
}

export function PipelineGraph({
  status,
  evaluations,
  revisions,
  verifications,
  agents,
  evaluatorModels,
  verifierModels,
  criteria = [],
  projects = [],
  selectedProjectId,
  hasReport,
  failed = false,
  events = [],
  loading = false,
}: PipelineGraphProps) {
  const { t } = useTranslation()
  const activeIndex = statusIndex(status)
  const evaluatorPool = agents?.evaluators ?? []
  const verifierPool = agents?.verifiers ?? []
  const [openAgentId, setOpenAgentId] = React.useState<string | null>(null)
  const popoverState = React.useMemo(() => ({ openId: openAgentId, setOpenId: setOpenAgentId }), [openAgentId])
  const projectNames = React.useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const live = Boolean(status && !['done', 'failed', 'cancelled'].includes(status))
  const now = useNow(live)
  const stages = React.useMemo(() => stageTimings(events), [events])
  const agentsTimings = React.useMemo(() => agentTimings(events, stages), [events, stages])

  const evaluatorSummaries = React.useMemo(
    () =>
      summariseAgents(
        evaluatorPool,
        'evaluator',
        evaluatorModels,
        evaluations,
        revisions,
        verifications,
        status,
        failed,
        selectedProjectId,
      ),
    [evaluations, evaluatorModels, evaluatorPool, failed, revisions, selectedProjectId, status, verifications],
  )

  const verifierSummaries = React.useMemo(
    () =>
      summariseAgents(
        verifierPool,
        'verifier',
        verifierModels,
        evaluations,
        revisions,
        verifications,
        status,
        failed,
        selectedProjectId,
      ),
    [evaluations, failed, revisions, selectedProjectId, status, verifications, verifierModels, verifierPool],
  )

  const nodes = React.useMemo<Node[]>(() => {
    const stageTimingFor = (id: string): Timing | undefined => {
      if (id === 'harvest' || id === 'review' || id === 'consensus') return stages.get(id)
      if (id === 'rank') {
        const start = stages.get('consensus')?.end
        if (start === undefined) return undefined
        const end = stages.get('verify')?.start
        return { start, ...(end !== undefined ? { end } : {}) }
      }
      const start = stages.get('harvest')?.start
      const end = stages.get('verify')?.end
      return start === undefined ? undefined : { start, ...(end !== undefined ? { end } : {}) }
    }

    const agentDurationOf = (summary: AgentSummary): string | undefined => {
      const stage = stages.get(summary.role === 'verifier' ? 'verify' : summary.revision ? 'review' : 'evaluate')
      const timing = agentsTimings.get(summary.agent.id)
      const start = timing?.start ?? stage?.start
      if (start === undefined) return undefined
      // An agent without its own result still stops counting when its stage
      // closes, so a failed agent does not show a duration that never ends.
      const candidate = timing?.end ?? stage?.end
      const end = candidate !== undefined && candidate >= start ? candidate : undefined
      return durationOf({ start, ...(end !== undefined ? { end } : {}) }, now)
    }

    const stageNodes = STAGES.map((stage) => {
      let stageStatus: StageStatus = 'idle'
      const index = stage.id === 'harvest' ? 0 : stage.id === 'review' ? 2 : stage.id === 'consensus' ? 3 : stage.id === 'rank' ? 4 : 5
      if (failed && index === Math.max(0, activeIndex)) stageStatus = 'error'
      else if (status === 'done' || hasReport) stageStatus = 'done'
      else if (index < activeIndex) stageStatus = 'done'
      else if (index === activeIndex) stageStatus = 'active'

      const detail =
        stage.id === 'review' && revisions.length > 0
          ? t('pipeline.revisionCount', { count: revisions.length })
          : stage.id === 'report' && hasReport
            ? t('pipeline.reportDetail')
            : t(stage.detailKey)
      const duration = durationOf(stageTimingFor(stage.id), now)

      return {
        id: stage.id,
        type: 'stage',
        position:
          stage.id === 'harvest'
            ? { x: 0, y: 96 }
            : stage.id === 'review'
              ? { x: 596, y: 96 }
              : stage.id === 'consensus'
                ? { x: 786, y: 96 }
                : stage.id === 'rank'
                  ? { x: 976, y: 96 }
                  : { x: 1356, y: 96 },
        data: { title: t(stage.titleKey), detail, status: stageStatus, ...(duration ? { duration } : {}) } satisfies StageData,
      }
    })

    const evaluatorNodes = evaluatorSummaries.map((summary, index) => {
      const column = index % 2
      const row = Math.floor(index / 2)
      const evaluation = summary.revision ?? summary.evaluation
      const duration = agentDurationOf(summary)
      return {
        id: `agent-${summary.agent.id}`,
        type: 'agent',
        position: { x: 200 + column * 188, y: row * 74 },
        // React Flow disables pointer events on nodes when the canvas is not
        // selectable or draggable. The agent cards must stay clickable.
        style: { pointerEvents: 'all' as const },
        data: {
          ...summary,
          criteria,
          ...(duration ? { duration } : {}),
          ...(evaluation ? { projectName: projectNames.get(evaluation.projectId) ?? evaluation.projectId } : {}),
        } satisfies AgentData,
      }
    })

    const verifierNodes = verifierSummaries.map((summary, index) => {
      const duration = agentDurationOf(summary)
      return {
        id: `agent-${summary.agent.id}`,
        type: 'agent',
        position: { x: 200 + index * 188, y: 232 },
        style: { pointerEvents: 'all' as const },
        data: {
          ...summary,
          criteria,
          ...(duration ? { duration } : {}),
          ...(summary.verification
            ? { projectName: projectNames.get(summary.verification.projectId) ?? summary.verification.projectId }
            : {}),
        } satisfies AgentData,
      }
    })

    return [...stageNodes, ...evaluatorNodes, ...verifierNodes]
  }, [
    activeIndex,
    agentsTimings,
    criteria,
    evaluatorSummaries,
    failed,
    hasReport,
    now,
    projectNames,
    revisions.length,
    stages,
    status,
    t,
    verifierSummaries,
  ])

  const edges = React.useMemo<Edge[]>(() => {
    const list: Edge[] = []
    const evalPhase = phaseOf('evaluate', status)
    const verifyPhase = phaseOf('verify', status)

    for (const summary of evaluatorSummaries) {
      const target = `agent-${summary.agent.id}`
      list.push({
        id: `harvest-${summary.agent.id}`,
        source: 'harvest',
        target,
        type: 'smoothstep',
        animated: evalPhase === 'active',
        style: { strokeWidth: 1.3 },
      })
      list.push({
        id: `${summary.agent.id}-review`,
        source: target,
        target: 'review',
        type: 'smoothstep',
        animated: evalPhase === 'active',
        style: { strokeWidth: 1.3 },
      })
    }

    list.push({
      id: 'review-consensus',
      source: 'review',
      target: 'consensus',
      type: 'smoothstep',
      animated: phaseOf('review', status) === 'active',
      style: { strokeWidth: 1.5 },
    })
    list.push({
      id: 'consensus-rank',
      source: 'consensus',
      target: 'rank',
      type: 'smoothstep',
      animated: status === 'consensus',
      style: { strokeWidth: 1.5 },
    })

    for (const summary of verifierSummaries) {
      const target = `agent-${summary.agent.id}`
      list.push({
        id: `rank-${summary.agent.id}`,
        source: 'rank',
        target,
        type: 'smoothstep',
        animated: verifyPhase === 'active',
        style: { strokeWidth: 1.3 },
      })
      list.push({
        id: `${summary.agent.id}-report`,
        source: target,
        target: 'report',
        type: 'smoothstep',
        animated: verifyPhase === 'active',
        style: { strokeWidth: 1.3 },
      })
    }

    return list
  }, [evaluatorSummaries, status, verifierSummaries])

  return (
    <div className="verdict-flow h-[320px] w-full overflow-hidden rounded-lg border border-border bg-muted/10 md:h-[340px]">
      <AgentPopoverContext.Provider value={popoverState}>
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2" aria-busy="true" aria-live="polite">
            <Loader2 className="h-5 w-5 animate-spin text-brand-primary" />
            <p className="text-[11px] text-muted-foreground">{t('pipeline.loading')}</p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.16 }}
            minZoom={0.35}
            onlyRenderVisibleElements
            panOnDrag
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} className="!bottom-1.5 !left-1.5" />
          </ReactFlow>
        )}
      </AgentPopoverContext.Provider>
    </div>
  )
}

export function StatusPill({ status, error, paused }: { status?: RunStatus; error?: string; paused?: boolean }) {
  const { t } = useTranslation()
  const tone =
    paused
      ? 'neutral'
      : status === 'done'
        ? 'success'
        : status === 'failed' || status === 'cancelled'
          ? 'danger'
          : status
            ? 'brand'
            : 'neutral'
  const key = error ? 'failed' : paused ? 'paused' : (status ?? 'idle')
  return (
    <Badge tone={tone as 'success' | 'danger' | 'brand' | 'neutral'} className="capitalize">
      {paused ? (
        <Pause className="h-3 w-3" />
      ) : status && !['done', 'failed', 'cancelled', 'queued'].includes(status) ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : null}
      {t(`status.${key}`, { defaultValue: key })}
    </Badge>
  )
}
