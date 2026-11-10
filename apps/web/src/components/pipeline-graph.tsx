'use client'

import * as React from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { Badge, cn } from '@verdict/ui'
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import type { RunStatus } from '@verdict/shared'

type StageStatus = 'idle' | 'active' | 'done' | 'error'

interface StageData extends Record<string, unknown> {
  title: string
  detail: string
  status: StageStatus
}

function StageNode({ data }: NodeProps) {
  const stage = data as StageData
  return (
    <div
      className={cn(
        'w-[190px] rounded-lg border bg-card px-3 py-2 shadow-sm transition-colors',
        stage.status === 'active' && 'border-brand-primary ring-2 ring-brand-primary/20',
        stage.status === 'done' && 'border-emerald-500/40',
        stage.status === 'error' && 'border-destructive/50',
        stage.status === 'idle' && 'border-border opacity-70',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-border" />
      <div className="flex items-center gap-1.5">
        {stage.status === 'done' ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        ) : stage.status === 'active' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-primary" />
        ) : stage.status === 'error' ? (
          <XCircle className="h-3.5 w-3.5 text-destructive" />
        ) : (
          <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />
        )}
        <span className="text-[12px] font-semibold">{stage.title}</span>
      </div>
      <p className="mt-0.5 pl-5 text-[10px] leading-tight text-muted-foreground">{stage.detail}</p>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-border" />
    </div>
  )
}

const nodeTypes = { stage: StageNode }

const STAGES = [
  { id: 'harvest', title: 'Harvest', detail: 'GitHub tarball + video' },
  { id: 'evaluate', title: '6 evaluators', detail: '4 criteria each' },
  { id: 'review', title: 'Cross-review', detail: 'anonymised revision' },
  { id: 'consensus', title: 'Consensus', detail: 'trimmed mean + spread' },
  { id: 'rank', title: 'Comparative rank', detail: 'ordinal, per track' },
  { id: 'verify', title: '2 verifiers', detail: 'audit + final scores' },
  { id: 'report', title: 'Report', detail: 'ranking + rank delta' },
] as const

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
      return 5
    case 'done':
      return 7
    default:
      return -1
  }
}

export interface PipelineGraphProps {
  status?: RunStatus
  evaluations: number
  revisions: number
  verifications: number
  hasReport: boolean
  failed?: boolean
}

export function PipelineGraph({ status, evaluations, revisions, verifications, hasReport, failed }: PipelineGraphProps) {
  const activeIndex = statusIndex(status)

  const nodes = React.useMemo<Node[]>(
    () =>
      STAGES.map((stage, index) => {
        let stageStatus: StageStatus = 'idle'
        if (failed && index === Math.max(0, activeIndex)) stageStatus = 'error'
        else if (status === 'done' || hasReport) stageStatus = 'done'
        else if (index < activeIndex) stageStatus = 'done'
        else if (index === activeIndex) stageStatus = 'active'

        const detail =
          stage.id === 'evaluate' && evaluations > 0
            ? `${evaluations} evaluations`
            : stage.id === 'review' && revisions > 0
              ? `${revisions} revisions`
              : stage.id === 'verify' && verifications > 0
                ? `${verifications} verdicts`
                : stage.detail

        return {
          id: stage.id,
          type: 'stage',
          position: { x: index * 215, y: 0 },
          data: { title: stage.title, detail, status: stageStatus } satisfies StageData,
        }
      }),
    [activeIndex, evaluations, failed, hasReport, revisions, status, verifications],
  )

  const edges = React.useMemo(
    () =>
      STAGES.slice(0, -1).map((stage, index) => ({
        id: `${stage.id}-${STAGES[index + 1]!.id}`,
        source: stage.id,
        target: STAGES[index + 1]!.id,
        animated: index < activeIndex && status !== 'done',
        style: { strokeWidth: 1.5 },
      })),
    [activeIndex, status],
  )

  return (
    <div className="h-[150px] w-full overflow-hidden rounded-lg border border-border bg-muted/10">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
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
    </div>
  )
}

export function StatusPill({ status, error }: { status?: RunStatus; error?: string }) {
  const tone =
    status === 'done'
      ? 'success'
      : status === 'failed' || status === 'cancelled'
        ? 'danger'
        : status
          ? 'brand'
          : 'neutral'
  const label = error ? 'failed' : (status ?? 'idle')
  return (
    <Badge tone={tone as 'success' | 'danger' | 'brand' | 'neutral'} className="capitalize">
      {status && !['done', 'failed', 'cancelled', 'queued'].includes(status) ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : null}
      {label}
    </Badge>
  )
}
