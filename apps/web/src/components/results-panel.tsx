'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronRight,
  Coins,
  FileCode2,
  Film,
  Flag,
  Layers,
  Minus,
  ShieldCheck,
  Trophy,
} from 'lucide-react'
import { Badge, Card, CardContent, CardHeader, CardTitle, Select, cn } from '@verdict/ui'
import {
  primaryTrack,
  projectTracks,
  type CriterionScore,
  type ProjectConsensus,
  type ProjectEvaluation,
  type ProjectInput,
  type ProjectVerification,
  type Report,
  type Rubric,
  type RunUsage,
  type TrackRanking,
  type UsageStage,
} from '@verdict/shared'
import { formatDate, formatTokens, pct, scoreTone } from '@/lib/format'

export interface ResultsPanelProps {
  report?: Report
  rubric?: Rubric
  manifest: ProjectInput[]
  consensus: ProjectConsensus[]
  evaluations: ProjectEvaluation[]
  verifications: ProjectVerification[]
  selectedId?: string
  onSelect: (projectId: string) => void
}

interface CriterionMeta {
  id: string
  label: string
  weight: number
}

/** One flat row per track header and per ranked project, so a huge manifest virtualises. */
type RankingRow =
  | { kind: 'track'; track: string; count: number; first: boolean }
  | { kind: 'entry'; track: string; entry: TrackRanking['entries'][number] }

function flattenRankings(rankings: TrackRanking[]): RankingRow[] {
  return rankings.flatMap((track, index) => [
    { kind: 'track' as const, track: track.track, count: track.entries.length, first: index === 0 },
    ...track.entries.map((entry) => ({ kind: 'entry' as const, track: track.track, entry })),
  ])
}

const TRACK_TONES = [
  'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300',
]

/** A stable colour per track name, so a track keeps its identity across renders. */
function trackTone(track: string): string {
  let hash = 0
  for (const char of track) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return TRACK_TONES[hash % TRACK_TONES.length] ?? TRACK_TONES[0]!
}

const STAGE_KEYS: Record<UsageStage, string> = {
  evaluation: 'results.stageEvaluation',
  revision: 'results.stageRevision',
  ranking: 'results.stageRanking',
  verification: 'results.stageVerification',
  verifier_ranking: 'results.stageVerifierRanking',
}

/**
 * Token and call summary for the whole pipeline. Tokens are the billable unit
 * the run actually reports, so the table stays honest about what a model cost
 * without inventing a price.
 */
function CostSummary({ usage, compact = false }: { usage?: RunUsage; compact?: boolean }) {
  const { t } = useTranslation()
  if (!usage) return null

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-semibold text-foreground">
          <Coins className="h-3 w-3 text-brand-primary" /> {t('results.pipelineUsage')}
        </span>
        <span className="tabular-nums">{t('results.calls', { count: usage.total.calls })}</span>
        <span className="tabular-nums">{t('results.tokensIn', { value: formatTokens(usage.total.inputTokens) })}</span>
        <span className="tabular-nums">{t('results.tokensOut', { value: formatTokens(usage.total.outputTokens) })}</span>
        {usage.byAgent.length > 0 ? (
          <span className="ml-auto">{t('results.agentCount', { count: usage.byAgent.length })}</span>
        ) : null}
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5">
        <Coins className="h-3.5 w-3.5 text-brand-primary" />
        <span className="text-[11px] font-semibold">{t('results.pipelineUsage')}</span>
        <span className="ml-auto flex flex-wrap gap-3 text-[10px] tabular-nums text-muted-foreground">
          <span>{t('results.calls', { count: usage.total.calls })}</span>
          <span>{t('results.tokensIn', { value: formatTokens(usage.total.inputTokens) })}</span>
          <span>{t('results.tokensOut', { value: formatTokens(usage.total.outputTokens) })}</span>
        </span>
      </div>
      <div className="grid gap-3 p-2 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{t('results.costPerAgent')}</p>
          <ul className="flex flex-col gap-0.5">
            {usage.byAgent.map((agent) => (
              <li key={`${agent.role}:${agent.agentId}`} className="flex items-center gap-1.5 text-[10px]">
                {agent.role === 'verifier' ? (
                  <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-600" />
                ) : (
                  <Bot className="h-3 w-3 shrink-0 text-brand-primary" />
                )}
                <span className="min-w-0 flex-1 truncate" title={agent.agentName}>
                  {t(`agents.${agent.agentId}.name`, { defaultValue: agent.agentName })}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{agent.calls}×</span>
                <span className="w-10 shrink-0 text-right tabular-nums">{formatTokens(agent.inputTokens + agent.outputTokens)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{t('results.costPerStage')}</p>
          <ul className="flex flex-col gap-0.5">
            {usage.byStage.map((stage) => (
              <li key={stage.stage} className="flex items-center gap-1.5 text-[10px]">
                <span className="min-w-0 flex-1 truncate">{t(STAGE_KEYS[stage.stage])}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{stage.calls}×</span>
                <span className="w-10 shrink-0 text-right tabular-nums">{formatTokens(stage.inputTokens + stage.outputTokens)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[9px] leading-tight text-muted-foreground">{t('results.costNote')}</p>
        </div>
      </div>
    </div>
  )
}

function provisionalRankings(manifest: ProjectInput[], consensus: ProjectConsensus[], rubric?: Rubric): TrackRanking[] {
  const byId = new Map(consensus.map((entry) => [entry.projectId, entry]))
  const groups = new Map<string, ProjectInput[]>()
  for (const project of manifest) {
    for (const track of projectTracks(project)) {
      groups.set(track, [...(groups.get(track) ?? []), project])
    }
  }
  const tieBreakers = rubric?.ranking.tieBreakers ?? []
  return [...groups.entries()].map(([track, projects]) => {
    const sorted = [...projects].sort((left, right) => {
      const l = byId.get(left.id)
      const r = byId.get(right.id)
      const delta = (r?.overall ?? 0) - (l?.overall ?? 0)
      if (delta !== 0) return delta
      for (const criterionId of tieBreakers) {
        const lc = l?.criteria.find((entry) => entry.criterionId === criterionId)?.score ?? 0
        const rc = r?.criteria.find((entry) => entry.criterionId === criterionId)?.score ?? 0
        if (rc !== lc) return rc - lc
      }
      return 0
    })
    return {
      track,
      entries: sorted.map((project, index) => ({
        projectId: project.id,
        name: project.name,
        track,
        rank: index + 1,
        overall: byId.get(project.id)?.overall ?? 0,
        ...(project.rank !== undefined && primaryTrack(project) === track
          ? { providedRank: project.rank, rankDelta: project.rank - (index + 1) }
          : {}),
        confidence: byId.get(project.id)?.confidence ?? 0,
        status: byId.get(project.id)?.status ?? 'escalated',
      })),
    }
  })
}

function averageVerifierScores(verifications: ProjectVerification[], criteria: CriterionMeta[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const criterion of criteria) {
    const values = verifications
      .map((verification) => verification.finalScores[criterion.id])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    result[criterion.id] = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  }
  return result
}

function DeltaPill({ delta }: { delta?: number }) {
  if (delta === undefined) return <span className="text-[10px] text-muted-foreground">-</span>
  if (delta === 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
        <Minus className="h-3 w-3" /> 0
      </span>
    )
  const up = delta > 0
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[10px] tabular-nums', up ? 'text-emerald-600' : 'text-destructive')}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(delta)}
    </span>
  )
}

function evaluatorScore(evaluation: ProjectEvaluation, criterionId: string): CriterionScore | undefined {
  return evaluation.scores.find((score) => score.criterionId === criterionId)
}

/**
 * Virtualised per-track ranking. Only the visible rows are mounted, so a
 * manifest with thousands of projects scrolls without slowing the page down.
 */
function RankingList({
  rankings,
  selected,
  onSelect,
}: {
  rankings: TrackRanking[]
  selected?: string
  onSelect: (projectId: string) => void
}) {
  const { t } = useTranslation()
  const rows = React.useMemo(() => flattenRankings(rankings), [rankings])

  return (
    <Virtuoso
      data={rows}
      className="h-full"
      // A project can be ranked in several tracks, so the track has to be part
      // of the key. Without it Virtuoso saw duplicate keys, reused the wrong
      // row and made entries repeat or disappear while scrolling.
      computeItemKey={(_index, row) => (row.kind === 'track' ? `track:${row.track}` : `entry:${row.track}:${row.entry.projectId}`)}
      itemContent={(_index, row) =>
        row.kind === 'track' ? (
          <div className={cn('px-2 pb-1', row.first ? 'pt-2' : 'pt-3')}>
            <div className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5', trackTone(row.track))}>
              <Layers className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide">{row.track}</span>
              <span className="shrink-0 rounded-full bg-background/70 px-1.5 py-0.5 text-[9px] tabular-nums">
                {t('results.trackProjects', { count: row.count })}
              </span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onSelect(row.entry.projectId)}
            className={cn(
              'flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left hover:bg-muted/50',
              selected === row.entry.projectId && 'bg-brand-primary/5',
            )}
          >
            <span className="w-5 shrink-0 text-center text-[11px] font-bold tabular-nums text-muted-foreground">
              {row.entry.rank}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium">{row.entry.name}</span>
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>{t(`status.${row.entry.status}`, { defaultValue: row.entry.status })}</span>
                <span>·</span>
                <span>{t('results.conf', { value: pct(row.entry.confidence) })}</span>
                {row.entry.providedRank !== undefined ? (
                  <>
                    <span>·</span>
                    <span>{t('results.wasRank', { rank: row.entry.providedRank })}</span>
                    <DeltaPill delta={row.entry.rankDelta} />
                  </>
                ) : null}
              </span>
            </span>
            <Badge tone={scoreTone(row.entry.overall)} className="tabular-nums">
              {row.entry.overall.toFixed(1)}
            </Badge>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        )
      }
    />
  )
}

export function ResultsPanel({
  report,
  rubric,
  manifest,
  consensus,
  evaluations,
  verifications,
  selectedId,
  onSelect,
}: ResultsPanelProps) {
  const { t } = useTranslation()
  const [trackFilter, setTrackFilter] = React.useState('all')
  const hasResults =
    Boolean(report) || consensus.length > 0 || evaluations.length > 0 || verifications.length > 0
  if (!hasResults) return null

  const criteria: CriterionMeta[] = report?.criteria ?? rubric?.criteria.map((criterion) => ({ id: criterion.id, label: criterion.label, weight: criterion.weight })) ?? []
  const rankings = report?.rankings ?? provisionalRankings(manifest, consensus, rubric)
  const reportsById = new Map((report?.projects ?? []).map((project) => [project.projectId, project]))
  // Multi-track runs rank every project in each of its tracks. The filter keeps
  // one track on screen at a time; a stale value falls back to every track.
  const trackNames = rankings.map((ranking) => ranking.track)
  const activeTrack = trackFilter !== 'all' && trackNames.includes(trackFilter) ? trackFilter : 'all'
  const visibleRankings = activeTrack === 'all' ? rankings : rankings.filter((ranking) => ranking.track === activeTrack)
  const fallbackId = rankings[0]?.entries[0]?.projectId
  const requested = selectedId ?? fallbackId
  const selected = visibleRankings.some((ranking) => ranking.entries.some((entry) => entry.projectId === requested))
    ? requested
    : visibleRankings[0]?.entries[0]?.projectId
  const selectedReport = selected ? reportsById.get(selected) : undefined
  const selectedConsensus = selectedReport?.consensus ?? consensus.find((entry) => entry.projectId === selected)
  const selectedEvaluations = evaluations.filter((evaluation) => evaluation.projectId === selected)
  const selectedVerifications = selectedReport?.verifications ?? verifications.filter((verification) => verification.projectId === selected)
  const finalScores = selectedReport?.finalScores ?? averageVerifierScores(selectedVerifications, criteria)
  const finalOverall = selectedReport?.finalOverall ?? selectedConsensus?.overall ?? 0
  const selectedProject = manifest.find((project) => project.id === selected)
  const sourceOfRanks = report ? 'final' : 'provisional'

  return (
    <div className="grid h-full min-h-0 grid-cols-1 grid-rows-2 gap-2 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:grid-rows-1">
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <CardHeader className="border-b border-border">
          <Trophy className="h-3.5 w-3.5 text-brand-primary" />
          <CardTitle>{t('results.ranking')}</CardTitle>
          <Badge tone={sourceOfRanks === 'final' ? 'success' : 'warning'} className="ml-auto">
            {t(`results.${sourceOfRanks}`)}
          </Badge>
        </CardHeader>
        {report?.usage ? (
          <div className="border-b border-border px-3 py-1.5">
            <CostSummary usage={report.usage} compact />
          </div>
        ) : null}
        {trackNames.length > 1 ? (
          <div className="flex items-center gap-2 border-b border-border px-4 py-1.5">
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{t('results.track')}</span>
            <Select
              value={activeTrack}
              onValueChange={setTrackFilter}
              ariaLabel={t('results.track')}
              options={[
                { value: 'all', label: t('results.allTracks') },
                ...trackNames.map((name) => ({ value: name, label: name })),
              ]}
              className="min-w-0 flex-1"
              triggerClassName="h-6 text-[10px]"
            />
          </div>
        ) : null}
        <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
          {manifest.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">{t('results.uploadManifest')}</p>
          ) : (
            <RankingList rankings={visibleRankings} selected={selected} onSelect={onSelect} />
          )}
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-col overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle className="truncate">{selectedProject?.name ?? t('results.projectDetail')}</CardTitle>
          {selectedConsensus ? (
            <Badge tone={selectedConsensus.status === 'consensus' ? 'success' : 'warning'} className="ml-auto">
              {t(`status.${selectedConsensus.status}`, { defaultValue: selectedConsensus.status })}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto">
          {!selected ? (
            <p className="text-xs text-muted-foreground">{t('results.selectProject')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {report?.usage ? <CostSummary usage={report.usage} /> : null}
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('results.finalOverall')}</p>
                  <p className="text-2xl font-bold tabular-nums">{finalOverall.toFixed(1)}</p>
                </div>
                {selectedConsensus ? (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('results.consensus')}</p>
                    <p className="text-lg font-semibold tabular-nums">{selectedConsensus.overall.toFixed(1)}</p>
                  </div>
                ) : null}
                {selectedConsensus ? (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('results.dispersion')}</p>
                    <p className="text-lg font-semibold tabular-nums">{selectedConsensus.dispersion.toFixed(1)}</p>
                  </div>
                ) : null}
                <div className="ml-auto flex gap-2 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <FileCode2 className="h-3 w-3" /> {t('results.files', { count: selectedReport?.evidence.repoFiles ?? 0 })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Film className="h-3 w-3" /> {t('results.segments', { count: selectedReport?.evidence.transcriptSegments ?? 0 })}
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-muted/50 text-left">
                      <th className="px-2 py-1 font-semibold">{t('results.criterion')}</th>
                      <th className="px-2 py-1 text-right font-semibold">{t('results.weight')}</th>
                      <th className="px-2 py-1 text-right font-semibold">{t('results.consensus')}</th>
                      <th className="px-2 py-1 text-right font-semibold">{t('results.spread')}</th>
                      <th className="px-2 py-1 text-right font-semibold">{t('results.finalColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {criteria.map((criterion) => {
                      const consensusEntry = selectedConsensus?.criteria.find((entry) => entry.criterionId === criterion.id)
                      const final = finalScores[criterion.id]
                      return (
                        <tr key={criterion.id} className="border-t border-border">
                          <td className="px-2 py-1 font-medium">{criterion.label}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{pct(criterion.weight)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{consensusEntry?.score.toFixed(1) ?? '-'}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{consensusEntry?.spread.toFixed(1) ?? '-'}</td>
                          <td className="px-2 py-1 text-right font-semibold tabular-nums">{final !== undefined ? final.toFixed(1) : '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {selectedEvaluations.length > 0 ? (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full border-collapse text-[10px]">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="sticky left-0 bg-muted/50 px-2 py-1 text-left font-semibold">{t('results.evaluator')}</th>
                        {criteria.map((criterion) => (
                          <th key={criterion.id} className="px-1.5 py-1 text-right font-semibold" title={criterion.label}>
                            {criterion.id.slice(0, 6)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEvaluations.map((evaluation) => (
                        <tr key={`${evaluation.agentId}-${evaluation.model}`} className="border-t border-border">
                          <td className="sticky left-0 max-w-[9rem] truncate bg-card px-2 py-1" title={evaluation.agentName}>
                            {evaluation.agentName}
                          </td>
                          {criteria.map((criterion) => {
                            const score = evaluatorScore(evaluation, criterion.id)
                            return (
                              <td
                                key={criterion.id}
                                className={cn('px-1.5 py-1 text-right tabular-nums', score && score.confidence < 0.4 && 'text-muted-foreground')}
                                title={score?.rationale}
                              >
                                {score?.score.toFixed(0) ?? '-'}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {selectedVerifications.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('results.verifierAudit')}</p>
                  {selectedVerifications.map((verification) => (
                    <div key={`${verification.verifierId}-${verification.model}`} className="rounded-md border border-border p-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium">{verification.verifierName}</span>
                        <Badge tone={verification.approved ? 'success' : 'danger'}>
                          {verification.approved ? t('results.approved') : t('results.flagged')}
                        </Badge>
                        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{verification.finalOverall.toFixed(1)}</span>
                      </div>
                      {verification.adjustments.length > 0 ? (
                        <ul className="mt-1 list-inside list-disc text-[10px] text-muted-foreground">
                          {verification.adjustments.map((adjustment) => (
                            <li key={adjustment.criterionId}>
                              {adjustment.criterionId}: {adjustment.from} → {adjustment.to}: {adjustment.reason}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-[10px] text-muted-foreground">{t('results.noAdjustment')}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              {selectedConsensus && selectedConsensus.disagreements.length > 0 ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                  <p className="flex items-center gap-1 text-[10px] font-semibold text-amber-600">
                    <Flag className="h-3 w-3" /> {t('results.disagreement')}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{selectedConsensus.disagreements.join(', ')}</p>
                </div>
              ) : null}

              {selectedReport?.evidence.errors.length ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                  <p className="text-[10px] font-semibold text-destructive">{t('results.harvestErrors')}</p>
                  <ul className="mt-0.5 list-inside list-disc text-[10px] text-muted-foreground">
                    {selectedReport.evidence.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {report ? (
                <p className="text-[10px] text-muted-foreground">
                  {t('results.reportGenerated', {
                    date: formatDate(report.createdAt),
                    evaluators: report.models.evaluators.length,
                    verifiers: report.models.verifiers.length,
                  })}
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
