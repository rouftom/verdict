'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  FileCode2,
  Film,
  Flag,
  Minus,
  Trophy,
} from 'lucide-react'
import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from '@verdict/ui'
import type {
  CriterionScore,
  ProjectConsensus,
  ProjectEvaluation,
  ProjectInput,
  ProjectVerification,
  Report,
  Rubric,
  TrackRanking,
} from '@verdict/shared'
import { formatDate, pct, scoreTone } from '@/lib/format'

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
  | { kind: 'track'; track: string; count: number }
  | { kind: 'entry'; entry: TrackRanking['entries'][number] }

function flattenRankings(rankings: TrackRanking[]): RankingRow[] {
  return rankings.flatMap((track) => [
    { kind: 'track' as const, track: track.track, count: track.entries.length },
    ...track.entries.map((entry) => ({ kind: 'entry' as const, entry })),
  ])
}

function provisionalRankings(manifest: ProjectInput[], consensus: ProjectConsensus[], rubric?: Rubric): TrackRanking[] {
  const byId = new Map(consensus.map((entry) => [entry.projectId, entry]))
  const groups = new Map<string, ProjectInput[]>()
  for (const project of manifest) {
    const track = project.track?.trim() || 'default'
    groups.set(track, [...(groups.get(track) ?? []), project])
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
        ...(project.rank !== undefined ? { providedRank: project.rank, rankDelta: project.rank - (index + 1) } : {}),
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
      computeItemKey={(_index, row) => (row.kind === 'track' ? `track:${row.track}` : `entry:${row.entry.projectId}`)}
      itemContent={(_index, row) =>
        row.kind === 'track' ? (
          <div className="flex items-center justify-between border-b border-border bg-muted/60 px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{row.track}</span>
            <span className="text-[10px] text-muted-foreground">{t('results.trackProjects', { count: row.count })}</span>
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
  const hasResults =
    Boolean(report) || consensus.length > 0 || evaluations.length > 0 || verifications.length > 0
  if (!hasResults) return null

  const criteria: CriterionMeta[] = report?.criteria ?? rubric?.criteria.map((criterion) => ({ id: criterion.id, label: criterion.label, weight: criterion.weight })) ?? []
  const rankings = report?.rankings ?? provisionalRankings(manifest, consensus, rubric)
  const reportsById = new Map((report?.projects ?? []).map((project) => [project.projectId, project]))
  const selected = selectedId ?? rankings[0]?.entries[0]?.projectId
  const selectedReport = selected ? reportsById.get(selected) : undefined
  const selectedConsensus = selectedReport?.consensus ?? consensus.find((entry) => entry.projectId === selected)
  const selectedEvaluations = evaluations.filter((evaluation) => evaluation.projectId === selected)
  const selectedVerifications = selectedReport?.verifications ?? verifications.filter((verification) => verification.projectId === selected)
  const finalScores = selectedReport?.finalScores ?? averageVerifierScores(selectedVerifications, criteria)
  const finalOverall = selectedReport?.finalOverall ?? selectedConsensus?.overall ?? 0
  const selectedProject = manifest.find((project) => project.id === selected)
  const sourceOfRanks = report ? 'final' : 'provisional'

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <CardHeader className="border-b border-border">
          <Trophy className="h-3.5 w-3.5 text-brand-primary" />
          <CardTitle>{t('results.ranking')}</CardTitle>
          <Badge tone={sourceOfRanks === 'final' ? 'success' : 'warning'} className="ml-auto">
            {t(`results.${sourceOfRanks}`)}
          </Badge>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
          {manifest.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">{t('results.uploadManifest')}</p>
          ) : (
            <RankingList rankings={rankings} selected={selected} onSelect={onSelect} />
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
