'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
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
import { Badge, cn } from '@verdict/ui'
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Flag,
  Loader2,
  Pause,
  ShieldCheck,
  UserRound,
  Workflow,
  XCircle,
} from 'lucide-react'
import { Swiper, SwiperSlide } from 'swiper/react'
import { A11y } from 'swiper/modules'
import type { Swiper as SwiperClass } from 'swiper'
import 'swiper/css'
import type {
  AgentInfo,
  ModelRef,
  ProjectConsensus,
  ProjectEvaluation,
  ProjectRevision,
  ProjectVerification,
  Report,
  RunEvent,
  RunStatus,
  StageOneResult,
} from '@verdict/shared'
import { agentTimings, durationOf, reportTiming, stageTimings, statusFromEvents, type Timing } from '@/lib/run-timeline'

type StageStatus = 'idle' | 'active' | 'done' | 'error'

interface StageMetric {
  label: string
  value: string
}

interface StageRow {
  label: string
  value: string
  /** `undefined` means informational, `true` passed, `false` failed. */
  ok?: boolean
}

interface StageData extends Record<string, unknown> {
  nodeId: string
  title: string
  detail: string
  status: StageStatus
  duration?: string
  metrics?: StageMetric[]
  rows?: StageRow[]
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
  /** Every project this agent returned a result for, in project order. */
  returns: AgentReturn[]
  count: number
}

/** One agent result for one project, as a slide in the agent card. */
interface AgentReturn {
  projectId: string
  projectName: string
  evaluation?: ProjectEvaluation
  revision?: ProjectRevision
  verification?: ProjectVerification
}

type AgentData = AgentSummary &
  Record<string, unknown> & {
    nodeId: string
    criteria: CriterionMeta[]
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

/** One spinner everywhere in the graph: node status, card and initial load. */
function NodeLoader({ className }: { className?: string }) {
  return <Loader2 aria-hidden strokeWidth={2.5} className={cn('h-3.5 w-3.5 animate-spin text-brand-primary', className)} />
}

function StatusIcon({ status, className }: { status: StageStatus; className?: string }) {
  if (status === 'done') return <CheckCircle2 className={cn('h-3.5 w-3.5 text-emerald-500', className)} />
  if (status === 'active') return <NodeLoader className={className} />
  if (status === 'error') return <XCircle className={cn('h-3.5 w-3.5 text-destructive', className)} />
  return <Circle className={cn('h-3.5 w-3.5 text-muted-foreground/50', className)} />
}

function StageNode({ data }: NodeProps) {
  const stage = data as StageData
  const popover = React.useContext(NodePopoverContext)
  const open = popover.openId === stage.nodeId
  return (
    <button
      type="button"
      title={stage.title}
      aria-expanded={open}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        popover.open(stage.nodeId, event.currentTarget.getBoundingClientRect())
      }}
      className={cn(
        'nodrag nopan w-[172px] cursor-pointer rounded-lg border bg-card px-3 py-2 text-left shadow-sm transition-colors',
        'hover:border-brand-primary/60 hover:bg-brand-primary/5',
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
    </button>
  )
}

/** Read-only synthesis for a pipeline stage, opened from its node. */
function StageCard({ data }: { data: StageData }) {
  const { t } = useTranslation()
  const tone = data.status === 'done' ? 'success' : data.status === 'active' ? 'brand' : data.status === 'error' ? 'danger' : 'neutral'
  const hasDetail = Boolean(data.metrics?.length) || Boolean(data.rows?.length)
  return (
    <div className="custom-scrollbar flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-primary/10 text-brand-primary">
          <Workflow className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold leading-tight">{data.title}</p>
          <p className="text-[10px] text-muted-foreground">{data.detail}</p>
        </div>
        <Badge tone={tone}>{t(`pipeline.stageState.${data.status}`)}</Badge>
      </div>

      {data.duration ? (
        <Badge tone="neutral" className="w-fit font-mono text-[10px] tabular-nums">
          {data.duration}
        </Badge>
      ) : null}

      {data.status === 'active' ? (
        <p className="flex items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
          <NodeLoader className="h-3 w-3" />
          {t('pipeline.cardRunning')}
        </p>
      ) : null}

      {data.metrics?.length ? (
        <div className="grid grid-cols-2 gap-1.5">
          {data.metrics.map((metric) => (
            <div key={metric.label} className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
              <p className="text-[9px] text-muted-foreground">{metric.label}</p>
              <p className="text-[12px] font-semibold tabular-nums">{metric.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {data.rows?.length ? (
        <div className="flex flex-col gap-1">
          {data.rows.map((row) => (
            <div key={`${row.label}-${row.value}`} className="flex items-center gap-2 text-[10px]">
              {row.ok === undefined ? (
                <Circle className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60" />
              ) : row.ok ? (
                <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-emerald-500" />
              ) : (
                <XCircle className="h-2.5 w-2.5 shrink-0 text-destructive" />
              )}
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {!hasDetail && data.status !== 'active' ? (
        <p className="rounded-md border border-dashed border-border bg-muted/20 p-2 text-[10px] text-muted-foreground">
          {t('pipeline.cardWaiting')}
        </p>
      ) : null}
    </div>
  )
}

function scoreClass(score: number): string {
  if (score >= 75) return 'text-emerald-600 dark:text-emerald-400'
  if (score >= 50) return 'text-amber-600 dark:text-amber-400'
  return 'text-destructive'
}

function modelName(model: ModelRef | undefined, notSet: string): string {
  return model ? `${model.provider} | ${model.model}` : notSet
}

function AgentReturnView({ data, entry }: { data: AgentData; entry: AgentReturn }) {
  const { t } = useTranslation()
  const latest = entry.revision ?? entry.evaluation
  const criteriaScores = React.useMemo(() => {
    const map = new Map<string, { score: number; confidence: number; rationale?: string }>()
    if (latest) {
      for (const score of latest.scores) {
        map.set(score.criterionId, { score: score.score, confidence: score.confidence, rationale: score.rationale })
      }
    }
    if (entry.verification) {
      for (const [criterionId, score] of Object.entries(entry.verification.finalScores)) {
        const previous = map.get(criterionId)
        map.set(criterionId, { score, confidence: previous?.confidence ?? 1, rationale: previous?.rationale })
      }
    }
    return map
  }, [entry.verification, latest])

  const overall = entry.verification?.finalOverall ?? latest?.overall
  const confidence =
    latest && latest.scores.length > 0
      ? latest.scores.reduce((sum, score) => sum + score.confidence, 0) / latest.scores.length
      : undefined
  const redFlags = entry.verification?.redFlags ?? latest?.redFlags ?? []
  const summary = entry.verification?.notes || latest?.summary || ''

  return (
    <div className="custom-scrollbar flex max-h-[48vh] flex-col gap-2 overflow-y-auto px-7 pb-1">
      <div className="flex items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold" title={entry.projectName}>
          {entry.projectName}
        </p>
        {entry.revision ? (
          <Badge tone="warning" className="text-[9px]">
            {t('pipeline.revised', { round: entry.revision.round })}
          </Badge>
        ) : null}
        {entry.verification ? (
          <Badge tone={entry.verification.approved ? 'success' : 'danger'} className="text-[9px]">
            {entry.verification.approved ? t('pipeline.approved') : t('pipeline.flagged')}
          </Badge>
        ) : null}
        {overall !== undefined ? <span className={cn('text-lg font-bold tabular-nums', scoreClass(overall))}>{overall.toFixed(1)}</span> : null}
      </div>

      {overall !== undefined ? (
        <>
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-[9px] text-muted-foreground">
                {entry.verification
                  ? t('pipeline.verifierFinalScore')
                  : confidence !== undefined
                    ? t('pipeline.confidence', { value: Math.round(confidence * 100) })
                    : t('pipeline.evaluatorScore')}
              </p>
            </div>
            <span className="min-w-0 truncate text-[10px] tabular-nums text-muted-foreground">
              {data.model ? data.model.model : t('pipeline.modelNotSet')}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            {data.criteria.map((criterion) => {
              const score = criteriaScores.get(criterion.id)
              return (
                <div key={criterion.id} className="flex items-center gap-2 text-[10px]">
                  <span className="min-w-0 flex-1 truncate">{criterion.label}</span>
                  <span className={cn('w-8 text-right font-semibold tabular-nums', score ? scoreClass(score.score) : 'text-muted-foreground')}>
                    {score ? score.score.toFixed(0) : '-'}
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

          {entry.verification && entry.verification.adjustments.length > 0 ? (
            <div className="rounded-md border border-border p-2">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{t('pipeline.adjustments')}</p>
              <ul className="mt-0.5 list-inside list-disc text-[10px] leading-snug text-muted-foreground">
                {entry.verification.adjustments.map((adjustment) => (
                  <li key={adjustment.criterionId}>
                    {adjustment.criterionId}: {adjustment.from} → {adjustment.to}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className="flex items-start gap-1.5 rounded-md border border-dashed border-border bg-muted/20 p-2 text-[10px] text-muted-foreground">
          {data.status === 'active' ? <NodeLoader className="mt-0.5 h-3 w-3" /> : null}
          <span>{t('pipeline.waiting')}</span>
        </p>
      )}
    </div>
  )
}

function AgentCard({ data }: { data: AgentData }) {
  const { t } = useTranslation()
  const returns = data.returns
  const [active, setActive] = React.useState(0)
  const swiperRef = React.useRef<SwiperClass | null>(null)

  React.useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, returns.length - 1)))
  }, [returns.length])

  const go = (direction: -1 | 1) => {
    const swiper = swiperRef.current
    if (!swiper) return
    if (direction < 0) swiper.slidePrev()
    else swiper.slideNext()
  }

  return (
    <div className="flex max-h-[70vh] flex-col gap-2">
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
      </div>

      <p className="text-[10px] leading-tight text-muted-foreground">
        {t(`agents.${data.agent.id}.focus`, { defaultValue: data.agent.focus })}
      </p>

      {returns.length > 0 ? (
        <div className="relative">
          {returns.length > 1 ? (
            <>
              <button
                type="button"
                aria-label={t('pipeline.previousProject')}
                onClick={() => go(-1)}
                disabled={active === 0}
                className="absolute top-1/2 left-0 z-10 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full border border-border bg-popover/95 text-popover-foreground shadow-md backdrop-blur transition-opacity hover:bg-muted disabled:opacity-30"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={t('pipeline.nextProject')}
                onClick={() => go(1)}
                disabled={active === returns.length - 1}
                className="absolute top-1/2 right-0 z-10 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full border border-border bg-popover/95 text-popover-foreground shadow-md backdrop-blur transition-opacity hover:bg-muted disabled:opacity-30"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}

          <Swiper
            modules={[A11y]}
            slidesPerView={1}
            spaceBetween={8}
            onSwiper={(swiper) => {
              swiperRef.current = swiper
            }}
            onSlideChange={(swiper) => setActive(swiper.activeIndex)}
            className="w-full"
          >
            {returns.map((entry) => (
              <SwiperSlide key={entry.projectId} className="!h-auto">
                <AgentReturnView data={data} entry={entry} />
              </SwiperSlide>
            ))}
          </Swiper>

          {returns.length > 1 ? (
            <div className="mt-1 flex items-center justify-center gap-1.5">
              {returns.map((entry, index) => (
                <button
                  key={entry.projectId}
                  type="button"
                  aria-label={t('pipeline.goToProject', { project: entry.projectName })}
                  aria-current={index === active ? 'true' : undefined}
                  onClick={() => swiperRef.current?.slideTo(index)}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    index === active ? 'w-5 bg-brand-primary' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60',
                  )}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="flex items-start gap-1.5 rounded-md border border-dashed border-border bg-muted/20 p-2 text-[10px] text-muted-foreground">
          {data.status === 'active' ? <NodeLoader className="mt-0.5 h-3 w-3" /> : null}
          <span>{t('pipeline.waiting')}</span>
        </p>
      )}

      <p className="flex items-center gap-1 text-[9px] text-muted-foreground">
        <Activity className="h-2.5 w-2.5" />
        {t('pipeline.resultCount', { count: data.count })}
      </p>
    </div>
  )
}

/**
 * Every node card opens from a fixed-position panel rendered in a portal. A
 * Radix popover inside a React Flow node fought the canvas for the click and
 * the dismissable layer, which is why a node could look inert. The panel is
 * independent of the canvas transform, of its overflow and of its pointer
 * event rules, so a click always opens exactly one card.
 */
interface NodePanel {
  id: string
  x: number
  y: number
}

const NodePopoverContext = React.createContext<{
  openId: string | null
  open: (id: string, anchor: DOMRect) => void
  close: () => void
}>({ openId: null, open: () => {}, close: () => {} })

const PANEL_WIDTH = 340
const PANEL_MARGIN = 8

/** Place the panel beside the node, switching sides when the viewport is tight. */
function panelPosition(anchor: DOMRect): { x: number; y: number } {
  const width = typeof window === 'undefined' ? PANEL_WIDTH : window.innerWidth
  const height = typeof window === 'undefined' ? 800 : window.innerHeight
  const maxX = width - PANEL_WIDTH - PANEL_MARGIN
  const x = anchor.right + PANEL_MARGIN <= maxX ? anchor.right + PANEL_MARGIN : Math.max(PANEL_MARGIN, anchor.left - PANEL_WIDTH - PANEL_MARGIN)
  const y = Math.min(Math.max(PANEL_MARGIN, anchor.top), Math.max(PANEL_MARGIN, height - 120))
  return { x, y }
}

function AgentNode({ data }: NodeProps) {
  const { t } = useTranslation()
  const agent = data as AgentData
  const latest = agent.revision ?? agent.evaluation
  const overall = agent.verification?.finalOverall ?? latest?.overall
  const popover = React.useContext(NodePopoverContext)
  const open = popover.openId === agent.nodeId
  return (
    <button
      type="button"
      title={t(`agents.${agent.agent.id}.name`, { defaultValue: agent.agent.name })}
      aria-expanded={open}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        popover.open(agent.nodeId, event.currentTarget.getBoundingClientRect())
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
  )
}

const nodeTypes = { stage: StageNode, agent: AgentNode }

const STAGES = [
  { id: 'harvest', titleKey: 'pipeline.harvest', detailKey: 'pipeline.harvestDetail' },
  { id: 'stageOne', titleKey: 'pipeline.stageOne', detailKey: 'pipeline.stageOneDetail' },
  { id: 'review', titleKey: 'pipeline.review', detailKey: 'pipeline.reviewDetail' },
  { id: 'consensus', titleKey: 'pipeline.consensus', detailKey: 'pipeline.consensusDetail' },
  { id: 'rank', titleKey: 'pipeline.rank', detailKey: 'pipeline.rankDetail' },
  { id: 'report', titleKey: 'pipeline.report', detailKey: 'pipeline.reportDetail' },
] as const

type Phase = 'before' | 'active' | 'after'

const ORDER: RunStatus[] = ['queued', 'parsing', 'harvesting', 'screening', 'evaluating', 'reviewing', 'consensus', 'verifying', 'done']

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
    case 'screening':
      return 1
    case 'evaluating':
      return 2
    case 'reviewing':
      return 3
    case 'consensus':
      return 4
    case 'verifying':
      return 5
    case 'done':
      return 6
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
  projects: { id: string; name: string }[],
  selectedProjectId?: string,
): AgentSummary[] {
  const projectOrder = projects.map((project) => project.id)
  const projectNames = new Map(projects.map((project) => [project.id, project.name]))
  const latestRevisionFor = (items: ProjectRevision[], projectId: string): ProjectRevision | undefined =>
    items
      .filter((entry) => entry.projectId === projectId)
      .reduce<ProjectRevision | undefined>((latest, entry) => (!latest || entry.round >= latest.round ? entry : latest), undefined)

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
    // One slide per project, so the card can swipe through every return this
    // agent produced instead of showing only the selected one.
    const projectIds = new Set<string>()
    for (const entry of role === 'evaluator' ? [...ownEvaluations, ...ownRevisions] : ownVerifications) {
      projectIds.add(entry.projectId)
    }
    const ordered = [
      ...projectOrder.filter((projectId) => projectIds.has(projectId)),
      ...[...projectIds].filter((projectId) => !projectOrder.includes(projectId)),
    ]
    if (selectedProjectId && ordered.includes(selectedProjectId)) {
      ordered.splice(ordered.indexOf(selectedProjectId), 1)
      ordered.unshift(selectedProjectId)
    }
    const returns: AgentReturn[] = ordered.map((projectId) => {
      const own = ownEvaluations.find((entry) => entry.projectId === projectId)
      const revised = latestRevisionFor(ownRevisions, projectId)
      const verified = ownVerifications.filter((entry) => entry.projectId === projectId).at(-1)
      return {
        projectId,
        projectName: projectNames.get(projectId) ?? projectId,
        ...(own ? { evaluation: own } : {}),
        ...(revised ? { revision: revised } : {}),
        ...(verified ? { verification: verified } : {}),
      }
    })
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
      returns,
      count: role === 'evaluator' ? ownEvaluations.length : ownVerifications.length,
    }
  })
}

export interface PipelineGraphProps {
  status?: RunStatus
  evaluations: ProjectEvaluation[]
  revisions: ProjectRevision[]
  verifications: ProjectVerification[]
  stageOne?: StageOneResult[]
  consensus?: ProjectConsensus[]
  report?: Report
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
  /** The agent pool is still loading: show the Loader2 spinner instead of an empty graph. */
  loading?: boolean
}

export function PipelineGraph({
  status,
  evaluations,
  revisions,
  verifications,
  stageOne = [],
  consensus = [],
  report,
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
  // A restored snapshot can lose its status while keeping the events. Rebuild
  // it from the stream so the nodes show a spinner instead of an idle ring.
  const current = status ?? statusFromEvents(events)
  const activeIndex = statusIndex(current)
  const evaluatorPool = agents?.evaluators ?? []
  const verifierPool = agents?.verifiers ?? []
  const [panel, setPanel] = React.useState<NodePanel | null>(null)
  const openNode = React.useCallback((id: string, anchor: DOMRect) => {
    setPanel({ id, ...panelPosition(anchor) })
  }, [])
  const closeNode = React.useCallback(() => setPanel(null), [])
  const popoverState = React.useMemo(
    () => ({ openId: panel?.id ?? null, open: openNode, close: closeNode }),
    [closeNode, openNode, panel?.id],
  )
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  // Close on Escape or resize. A scroll only closes the card when it happens
  // outside it: the card has its own scrollable content, and closing it while
  // the reader scrolls a long synthesis made the panel feel unstable.
  React.useEffect(() => {
    if (!panel) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null)
    }
    const close = () => setPanel(null)
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return
      setPanel(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [panel])
  const projectNames = React.useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const live = Boolean(current && !['done', 'failed', 'cancelled'].includes(current))
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
        current,
        failed,
        projects,
        selectedProjectId,
      ),
    [current, evaluations, evaluatorModels, evaluatorPool, failed, projects, revisions, selectedProjectId, verifications],
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
        current,
        failed,
        projects,
        selectedProjectId,
      ),
    [current, evaluations, failed, projects, revisions, selectedProjectId, verifications, verifierModels, verifierPool],
  )

  const nodes = React.useMemo<Node[]>(() => {
    const stageTimingFor = (id: string): Timing | undefined => {
      // The report is not a stage event: it runs from the end of the last
      // stage to its own event, never from the harvest start.
      if (id === 'report') return reportTiming(events)
      if (id === 'harvest' || id === 'stageOne' || id === 'review' || id === 'consensus') return stages.get(id)
      if (id === 'rank') {
        const start = stages.get('consensus')?.end
        if (start === undefined) return undefined
        const end = stages.get('verify')?.start
        return { start, ...(end !== undefined ? { end } : {}) }
      }
      return undefined
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

    const stageMetrics = (id: (typeof STAGES)[number]['id']): StageMetric[] => {
      if (id === 'harvest') return [{ label: t('pipeline.projects'), value: String(projects.length) }]
      if (id === 'stageOne') {
        const passed = stageOne.filter((result) => result.passed).length
        return [{ label: t('pipeline.stageOne'), value: t('pipeline.stageOneCount', { passed, total: stageOne.length }) }]
      }
      if (id === 'review') return [{ label: t('pipeline.revisions'), value: String(revisions.length) }]
      if (id === 'consensus') {
        const reached = consensus.filter((entry) => entry.status === 'consensus').length
        const escalated = consensus.length - reached
        return [
          { label: t('pipeline.consensusReached'), value: `${reached}/${consensus.length}` },
          { label: t('pipeline.escalated'), value: String(escalated) },
        ]
      }
      if (id === 'rank') {
        if (!report) return []
        return [
          { label: t('pipeline.tracks'), value: String(report.rankings.length) },
          { label: t('pipeline.ranked'), value: String(report.rankings.reduce((sum, track) => sum + track.entries.length, 0)) },
        ]
      }
      if (!report) return []
      return [
        { label: t('pipeline.criteria'), value: String(report.criteria.length) },
        { label: t('pipeline.projects'), value: String(new Set(report.projects.map((project) => project.projectId)).size) },
      ]
    }

    const stageRows = (id: (typeof STAGES)[number]['id']): StageRow[] | undefined => {
      if (id === 'stageOne') {
        return stageOne.slice(0, 10).map((result) => ({
          label: projectNames.get(result.projectId) ?? result.projectId,
          value: result.passed ? t('pipeline.passed') : t('pipeline.failed'),
          ok: result.passed,
        }))
      }
      if (id === 'review') {
        const latestRound = new Map<string, number>()
        for (const revision of revisions) {
          latestRound.set(revision.projectId, Math.max(latestRound.get(revision.projectId) ?? 0, revision.round))
        }
        return [...latestRound].slice(0, 10).map(([projectId, round]) => ({
          label: projectNames.get(projectId) ?? projectId,
          value: t('pipeline.round', { round }),
          ok: true,
        }))
      }
      if (id === 'consensus') {
        return consensus.slice(0, 10).map((entry) => ({
          label: projectNames.get(entry.projectId) ?? entry.projectId,
          value: Number.isFinite(entry.overall) ? entry.overall.toFixed(1) : '-',
          ok: entry.status === 'consensus',
        }))
      }
      if (id === 'rank') {
        return report?.rankings.map((track) => ({
          label: track.track,
          value: String(track.entries.length),
          ok: true,
        }))
      }
      if (id === 'report') {
        return report?.rankings.map((track) => ({
          label: track.track,
          value: track.entries[0]?.name ?? '-',
          ok: true,
        }))
      }
      return undefined
    }

    const stageNodes = STAGES.map((stage) => {
      let stageStatus: StageStatus = 'idle'
      const index =
        stage.id === 'harvest'
          ? 0
          : stage.id === 'stageOne'
            ? 1
            : stage.id === 'review'
              ? 3
              : stage.id === 'consensus'
                ? 4
                : stage.id === 'rank'
                  ? 5
                  : 6
      if (failed && index === Math.max(0, activeIndex)) stageStatus = 'error'
      else if (current === 'done' || hasReport) stageStatus = 'done'
      else if (index < activeIndex) stageStatus = 'done'
      else if (index === activeIndex) stageStatus = 'active'

      const detail =
        stage.id === 'stageOne' && stageOne.length > 0
          ? t('pipeline.stageOneCount', {
              passed: stageOne.filter((result) => result.passed).length,
              total: stageOne.length,
            })
          : stage.id === 'review' && revisions.length > 0
            ? t('pipeline.revisionCount', { count: revisions.length })
            : stage.id === 'report' && hasReport
              ? t('pipeline.reportDetail')
              : t(stage.detailKey)
      const duration = durationOf(stageTimingFor(stage.id), now)
      const metrics = stageMetrics(stage.id)
      const rows = stageRows(stage.id)

      return {
        id: stage.id,
        type: 'stage',
        position:
          stage.id === 'harvest'
            ? { x: -200, y: 96 }
            : stage.id === 'stageOne'
              ? { x: 0, y: 96 }
              : stage.id === 'review'
                ? { x: 596, y: 96 }
                : stage.id === 'consensus'
                  ? { x: 786, y: 96 }
                  : stage.id === 'rank'
                    ? { x: 976, y: 96 }
                    : { x: 1356, y: 96 },
        // React Flow disables pointer events on nodes when the canvas is not
        // selectable or draggable. Every card must stay clickable.
        style: { pointerEvents: 'all' as const },
        data: {
          nodeId: stage.id,
          title: t(stage.titleKey),
          detail,
          status: stageStatus,
          ...(duration ? { duration } : {}),
          ...(metrics.length > 0 ? { metrics } : {}),
          ...(rows && rows.length > 0 ? { rows } : {}),
        } satisfies StageData,
      }
    })

    const evaluatorNodes = evaluatorSummaries.map((summary, index) => {
      const column = index % 2
      const row = Math.floor(index / 2)
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
          nodeId: `agent-${summary.agent.id}`,
          criteria,
          ...(duration ? { duration } : {}),
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
          nodeId: `agent-${summary.agent.id}`,
          criteria,
          ...(duration ? { duration } : {}),
        } satisfies AgentData,
      }
    })

    return [...stageNodes, ...evaluatorNodes, ...verifierNodes]
  }, [
    activeIndex,
    agentsTimings,
    consensus,
    criteria,
    current,
    evaluatorSummaries,
    events,
    failed,
    hasReport,
    now,
    projectNames,
    projects,
    report,
    revisions,
    stageOne,
    stages,
    t,
    verifierSummaries,
  ])

  const edges = React.useMemo<Edge[]>(() => {
    const list: Edge[] = []
    const evalPhase = phaseOf('evaluate', current)
    const verifyPhase = phaseOf('verify', current)

    list.push({
      id: 'harvest-stageOne',
      source: 'harvest',
      target: 'stageOne',
      type: 'smoothstep',
      animated: current === 'screening',
      style: { strokeWidth: 1.5 },
    })

    for (const summary of evaluatorSummaries) {
      const target = `agent-${summary.agent.id}`
      list.push({
        id: `stageOne-${summary.agent.id}`,
        source: 'stageOne',
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
      animated: phaseOf('review', current) === 'active',
      style: { strokeWidth: 1.5 },
    })
    list.push({
      id: 'consensus-rank',
      source: 'consensus',
      target: 'rank',
      type: 'smoothstep',
      animated: current === 'consensus',
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
  }, [current, evaluatorSummaries, verifierSummaries])

  const panelNode = React.useMemo(() => {
    if (!panel) return undefined
    return nodes.find((entry) => entry.id === panel.id)
  }, [nodes, panel])

  const panelLabel = panelNode
    ? panelNode.type === 'agent'
      ? t(`agents.${(panelNode.data as AgentData).agent.id}.name`, { defaultValue: (panelNode.data as AgentData).agent.name })
      : (panelNode.data as StageData).title
    : undefined

  return (
    <div className="verdict-flow h-[320px] w-full overflow-hidden rounded-lg border border-border bg-muted/10 md:h-[340px]">
      <NodePopoverContext.Provider value={popoverState}>
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2" aria-busy="true" aria-live="polite">
            <NodeLoader className="h-5 w-5" />
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
        {panel && panelNode && panelLabel && typeof document !== 'undefined'
          ? createPortal(
              <div
                className="fixed inset-0 z-[999]"
                aria-hidden
                onPointerDown={(event) => {
                  event.stopPropagation()
                  closeNode()
                }}
                onWheel={(event) => event.stopPropagation()}
              >
                <div
                  ref={panelRef}
                  role="dialog"
                  aria-label={panelLabel}
                  className="fixed w-[340px] rounded-2xl border border-border bg-popover p-2.5 text-popover-foreground shadow-xl"
                  style={{ left: panel.x, top: panel.y }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  {panelNode.type === 'agent' ? (
                    <AgentCard data={panelNode.data as AgentData} />
                  ) : (
                    <StageCard data={panelNode.data as StageData} />
                  )}
                </div>
              </div>,
              document.body,
            )
          : null}
      </NodePopoverContext.Provider>
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
