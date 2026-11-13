'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Swiper, SwiperSlide } from 'swiper/react'
import { A11y } from 'swiper/modules'
import type { Swiper as SwiperClass } from 'swiper'
import 'swiper/css'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Crown,
  Gavel,
  LayoutGrid,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Swords,
  Trash2,
  Users,
  Vote,
  X,
  XCircle,
} from 'lucide-react'
import { Badge, Button, Label, Progress, SearchSelect, cn } from '@verdict/ui'
import type {
  ArenaAgent,
  ArenaEvent,
  ArenaSnapshot,
  ArenaStatus,
  ArenaVote,
  ModelRef,
  ProjectInput,
  ProviderInfo,
} from '@verdict/shared'
import {
  cancelArena,
  createArena,
  fetchArena,
  previewInputs,
  subscribeArena,
  type PreviewResponse,
} from '@/lib/api'
import { modelGroups } from '@/components/model-slots'
import { UploadCard } from '@/components/upload-card'

export interface ArenaWorkspaceProps {
  open: boolean
  onClose: () => void
  manifestText: string
  manifestFilename?: string
  rulesText: string
  rulesFilename?: string
  providers: ProviderInfo[]
  defaults: ModelRef[]
}

interface PopulationRow {
  id: string
  /** `provider:model`, the same key the model picker uses. */
  model: string
  count: number
}

type AgentState = 'idle' | 'active' | 'done' | 'error'

const MAX_CANDIDATES = 8
const MAX_AGENTS = 24

function modelKey(ref: ModelRef | undefined): string {
  return ref ? `${ref.provider}:${ref.model}` : ''
}

function modelFromKey(key: string): ModelRef | undefined {
  const separator = key.indexOf(':')
  if (separator <= 0) return undefined
  return { provider: key.slice(0, separator) as ModelRef['provider'], model: key.slice(separator + 1) }
}

function uniqueModels(providers: ProviderInfo[], defaults: ModelRef[]): ModelRef[] {
  const seen = new Set<string>()
  const list: ModelRef[] = []
  for (const ref of [...defaults, ...providers.filter((provider) => provider.configured).flatMap((provider) => provider.models.map((model) => ({ provider: provider.id, model: model.id })))]) {
    const key = modelKey(ref)
    if (!key || seen.has(key)) continue
    seen.add(key)
    list.push({ provider: ref.provider, model: ref.model })
  }
  return list
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function AgentStatusIcon({ state }: { state: AgentState }) {
  if (state === 'done') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
  if (state === 'active') return <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-primary" />
  if (state === 'error') return <XCircle className="h-3.5 w-3.5 text-destructive" />
  return <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />
}

function statusTone(status: ArenaStatus | 'idle'): 'neutral' | 'brand' | 'success' | 'danger' {
  if (status === 'done') return 'success'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  if (status === 'running' || status === 'queued') return 'brand'
  return 'neutral'
}

/**
 * Full-screen voting stage. The left rail keeps the workspace inputs and the
 * population editor; the right side is the live tally and ballot feed; the
 * bottom rail is a Swiper of the voters themselves.
 */
export function ArenaWorkspace({
  open,
  onClose,
  manifestText,
  manifestFilename,
  rulesText,
  rulesFilename,
  providers,
  defaults,
}: ArenaWorkspaceProps) {
  const { t } = useTranslation()
  const [mode, setMode] = React.useState<'duel' | 'grid'>('duel')
  const [manifest, setManifest] = React.useState(manifestText)
  const [manifestName, setManifestName] = React.useState<string | undefined>(manifestFilename)
  const [rules, setRules] = React.useState(rulesText)
  const [rulesName, setRulesName] = React.useState<string | undefined>(rulesFilename)
  const [temperature, setTemperature] = React.useState(0.4)

  const [preview, setPreview] = React.useState<PreviewResponse | null>(null)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [rows, setRows] = React.useState<PopulationRow[]>([])

  const [arena, setArena] = React.useState<ArenaSnapshot | null>(null)
  const [status, setStatus] = React.useState<ArenaStatus | 'idle'>('idle')
  const [votes, setVotes] = React.useState<ArenaVote[]>([])
  const [started, setStarted] = React.useState<Record<string, boolean>>({})
  const [agentErrors, setAgentErrors] = React.useState<Record<string, string>>({})
  const [starting, setStarting] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const unsubscribe = React.useRef<(() => void) | null>(null)
  const [activeAgent, setActiveAgent] = React.useState(0)
  const swiperRef = React.useRef<SwiperClass | null>(null)

  const limit = mode === 'duel' ? 2 : MAX_CANDIDATES
  const projects = preview?.projects ?? []
  const seedPool = React.useMemo(() => uniqueModels(providers, defaults), [providers, defaults])
  const groups = React.useMemo(() => modelGroups(providers), [providers])

  // One row per model, seeded from the provider defaults the first time the
  // catalogue is available. A second distinct model makes the population
  // diverse by default instead of putting every voter on the same model.
  React.useEffect(() => {
    if (rows.length > 0 || seedPool.length === 0) return
    const first = seedPool[0]!
    const second = seedPool.find((ref) => modelKey(ref) !== modelKey(first))
    setRows(
      second
        ? [
            { id: 'row-1', model: modelKey(first), count: 3 },
            { id: 'row-2', model: modelKey(second), count: 3 },
          ]
        : [{ id: 'row-1', model: modelKey(first), count: 4 }],
    )
  }, [rows.length, seedPool])

  // Debounced validation, same endpoint as the main workspace.
  React.useEffect(() => {
    if (!manifest.trim()) {
      setPreview(null)
      setPreviewError(null)
      setPreviewing(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setPreviewing(true)
      void previewInputs({ manifestText: manifest, rulesText: rules })
        .then((result) => {
          if (cancelled) return
          setPreview(result)
          setPreviewError(null)
        })
        .catch((cause) => {
          if (cancelled) return
          setPreview(null)
          setPreviewError(messageOf(cause))
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false)
        })
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [manifest, rules])

  const signature = projects.map((project) => project.id).join('|')
  React.useEffect(() => {
    const known = new Set(projects.map((project) => project.id))
    setSelectedIds((current) => {
      const valid = current.filter((id) => known.has(id)).slice(0, limit)
      if (valid.length >= Math.min(2, projects.length)) return valid
      const target = Math.min(limit === 2 ? 2 : 4, projects.length)
      for (const project of projects) {
        if (valid.length >= target) break
        if (!valid.includes(project.id)) valid.push(project.id)
      }
      return valid
    })
    // Only a change in the project list should re-seed the shortlist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, limit])

  React.useEffect(() => () => unsubscribe.current?.(), [])

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const applyEvent = React.useCallback((event: ArenaEvent) => {
    if (event.type === 'stage') {
      if (event.message === 'voting') setStatus('running')
      if (event.message === 'done') setStatus('done')
      return
    }
    if (event.type === 'log' && event.agentId) {
      setStarted((current) => ({ ...current, [event.agentId!]: true }))
      return
    }
    if (event.type === 'vote' && event.data) {
      const vote = event.data as ArenaVote
      setStarted((current) => ({ ...current, [vote.agentId]: true }))
      setVotes((current) => {
        const index = current.findIndex((entry) => entry.agentId === vote.agentId)
        if (index < 0) return [...current, vote]
        const next = [...current]
        next[index] = vote
        return next
      })
      return
    }
    if (event.type === 'error') {
      if (event.agentId) {
        setAgentErrors((current) => ({ ...current, [event.agentId!]: event.message ?? t('arena.failed') }))
        return
      }
      const message = event.message ?? t('arena.failed')
      if (/cancelled|annul/i.test(message)) {
        setStatus('cancelled')
      } else {
        setError(message)
        setStatus('failed')
      }
    }
  }, [t])

  const refresh = React.useCallback(async (id: string) => {
    try {
      const snapshot = await fetchArena(id)
      setArena(snapshot)
      setStatus(snapshot.status)
      setVotes(snapshot.votes)
      if (snapshot.error && snapshot.status !== 'cancelled') setError(snapshot.error)
      if (['done', 'failed', 'cancelled'].includes(snapshot.status)) {
        unsubscribe.current?.()
        unsubscribe.current = null
      }
    } catch {
      /* the SSE stream is the primary path; a poll failure is transient */
    }
  }, [])

  React.useEffect(() => {
    if (status !== 'running' && status !== 'queued') return
    if (!arena) return
    const timer = setInterval(() => void refresh(arena.id), 4000)
    return () => clearInterval(timer)
  }, [arena, refresh, status])

  const start = async () => {
    if (starting || !preview || selectedIds.length < 2) return
    const population = rows
      .map((row) => ({ model: modelFromKey(row.model), count: row.count }))
      .filter((row): row is { model: ModelRef; count: number } => Boolean(row.model))
    if (population.length === 0) return
    unsubscribe.current?.()
    unsubscribe.current = null
    setStarting(true)
    setError(null)
    setArena(null)
    setVotes([])
    setStarted({})
    setAgentErrors({})
    setActiveAgent(0)
    setStatus('queued')
    try {
      const created = await createArena({
        mode,
        manifestText: manifest,
        manifestFilename: manifestName ?? 'manifest.json',
        rulesText: rules,
        rulesFilename: rulesName ?? 'rules.md',
        candidateIds: selectedIds,
        agents: population,
        temperature,
      })
      const snapshot = await fetchArena(created.id)
      setArena(snapshot)
      setStatus(snapshot.status)
      setVotes(snapshot.votes)
      unsubscribe.current = subscribeArena(created.id, applyEvent, () => void refresh(created.id))
    } catch (cause) {
      setError(messageOf(cause))
      setStatus('failed')
    } finally {
      setStarting(false)
    }
  }

  const stop = async () => {
    if (!arena || cancelling) return
    setCancelling(true)
    try {
      const result = await cancelArena(arena.id)
      unsubscribe.current?.()
      unsubscribe.current = null
      setStatus(result.status)
      setError(null)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setCancelling(false)
    }
  }

  const reset = () => {
    unsubscribe.current?.()
    unsubscribe.current = null
    setArena(null)
    setVotes([])
    setStarted({})
    setAgentErrors({})
    setError(null)
    setStatus('idle')
    setActiveAgent(0)
  }

  const toggleCandidate = (id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id)
      if (current.length >= limit) return current
      return [...current, id]
    })
  }

  const addRow = () => {
    const used = new Set(rows.map((row) => row.model))
    const next = seedPool.find((ref) => !used.has(modelKey(ref))) ?? seedPool[0]
    if (!next) return
    setRows((current) => [
      ...current,
      { id: `row-${Date.now()}`, model: modelKey(next), count: 2 },
    ])
  }

  const updateRow = (id: string, patch: Partial<PopulationRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const totalAgents = rows.reduce((sum, row) => sum + row.count, 0)
  const stageCandidates = arena?.candidates ?? projects.filter((project) => selectedIds.includes(project.id))
  const candidateNames = React.useMemo(
    () => new Map(stageCandidates.map((project) => [project.id, project.name])),
    [stageCandidates],
  )
  const voteByAgent = React.useMemo(() => new Map(votes.map((vote) => [vote.agentId, vote])), [votes])
  const totalBallots = votes.length
  const tally = React.useMemo(
    () =>
      stageCandidates
        .map((project) => {
          const own = votes.filter((vote) => vote.chosenProjectId === project.id)
          const confidence =
            own.length > 0 ? own.reduce((sum, vote) => sum + vote.confidence, 0) / own.length : 0
          return {
            project,
            votes: own.length,
            confidence,
            share: totalBallots > 0 ? own.length / totalBallots : 0,
          }
        })
        .sort((left, right) => right.votes - left.votes || left.project.name.localeCompare(right.project.name)),
    [stageCandidates, totalBallots, votes],
  )
  const tied = tally.length > 1 && tally[0]!.votes > 0 && tally[0]!.votes === tally[1]!.votes
  const winner = status === 'done' && !tied ? tally[0] : undefined
  const feed = React.useMemo(
    () => [...votes].sort((left, right) => right.at.localeCompare(left.at)),
    [votes],
  )
  const agentRows = (arena?.agents ?? []).map((agent) => {
    const vote = voteByAgent.get(agent.id)
    const terminal = status === 'done' || status === 'failed' || status === 'cancelled'
    const state: AgentState = vote
      ? 'done'
      : agentErrors[agent.id]
        ? 'error'
        : started[agent.id] && !terminal
          ? 'active'
          : 'idle'
    // A voter whose call was cut short by a cancel or a failure must stop
    // spinning; the card says the vote never landed instead.
    const stalled = started[agent.id] && terminal && !vote && !agentErrors[agent.id]
    return { agent, vote, error: agentErrors[agent.id], state, stalled }
  })
  const ready =
    Boolean(manifest.trim()) &&
    projects.length >= 2 &&
    selectedIds.length >= 2 &&
    (mode === 'duel' ? selectedIds.length === 2 : selectedIds.length <= MAX_CANDIDATES) &&
    totalAgents > 0 &&
    totalAgents <= MAX_AGENTS &&
    rows.every((row) => Boolean(modelFromKey(row.model))) &&
    !starting &&
    status !== 'running' &&
    status !== 'queued'

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('arena.title')}
      className="fixed inset-0 z-[70] flex flex-col bg-background"
    >
      <header className="z-10 flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary">
            <Swords className="h-4 w-4" />
          </span>
          <div className="leading-none">
            <p className="text-[13px] font-bold tracking-tight">{t('arena.title')}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{t('arena.tagline')}</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5" role="group" aria-label={t('arena.mode')}>
            <Button
              type="button"
              variant={mode === 'duel' ? 'primary' : 'ghost'}
              size="sm"
              className="h-6 px-2 text-[10px]"
              aria-pressed={mode === 'duel'}
              disabled={Boolean(arena && (status === 'running' || status === 'queued'))}
              onClick={() => {
                setMode('duel')
                setSelectedIds((current) => current.slice(0, 2))
              }}
            >
              <Gavel className="h-3 w-3" /> {t('arena.duel')}
            </Button>
            <Button
              type="button"
              variant={mode === 'grid' ? 'primary' : 'ghost'}
              size="sm"
              className="h-6 px-2 text-[10px]"
              aria-pressed={mode === 'grid'}
              disabled={Boolean(arena && (status === 'running' || status === 'queued'))}
              onClick={() => setMode('grid')}
            >
              <LayoutGrid className="h-3 w-3" /> {t('arena.grid')}
            </Button>
          </div>
          <Badge tone={statusTone(status)}>
            {status === 'running' || status === 'queued' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {t(`arena.status.${status}`, { defaultValue: status })}
          </Badge>
          {arena && (status === 'running' || status === 'queued') ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-7 px-2 text-[10px]"
              disabled={cancelling}
              onClick={() => void stop()}
            >
              {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              {t('arena.cancel')}
            </Button>
          ) : arena ? (
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={reset}>
              <RotateCcw className="h-3 w-3" /> {t('arena.reset')}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('arena.close')} onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1800px] grid-cols-1 gap-3 p-3 xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="flex min-w-0 flex-col gap-3">
            <section className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <Swords className="h-3.5 w-3.5 text-brand-primary" />
                <h2 className="text-xs font-semibold">{t('arena.inputs')}</h2>
                <span className="ml-auto text-[10px] text-muted-foreground">{t('arena.inputsHint')}</span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <UploadCard
                  id="arena-manifest"
                  label={t('inputs.manifestLabel')}
                  hint={t('inputs.manifestHint')}
                  accept=".json,.yaml,.yml,application/json,text/yaml"
                  filename={manifestName}
                  text={manifest}
                  required
                  disabled={status === 'running' || status === 'queued'}
                  onFile={(filename, text) => {
                    setManifest(text)
                    setManifestName(filename)
                  }}
                  onClear={() => {
                    setManifest('')
                    setManifestName(undefined)
                  }}
                />
                <UploadCard
                  id="arena-rules"
                  label={t('inputs.rulesLabel')}
                  hint={t('inputs.rulesHint')}
                  accept=".md,.markdown,.txt,.yaml,.yml"
                  filename={rulesName}
                  text={rules}
                  disabled={status === 'running' || status === 'queued'}
                  onFile={(filename, text) => {
                    setRules(text)
                    setRulesName(filename)
                  }}
                  onClear={() => {
                    setRules('')
                    setRulesName(undefined)
                  }}
                />
              </div>
              {previewError ? (
                <p className="mt-2 flex items-start gap-1.5 text-[10px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {previewError}
                </p>
              ) : null}
              {previewing && !preview ? (
                <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> {t('arena.reading')}
                </p>
              ) : null}
            </section>

            <section className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Vote className="h-3.5 w-3.5 text-brand-primary" />
                <h2 className="text-xs font-semibold">{t('arena.candidates')}</h2>
                <Badge tone="neutral" className="ml-auto font-mono tabular-nums">
                  {selectedIds.length} / {limit}
                </Badge>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {mode === 'duel' ? t('arena.duelHint') : t('arena.gridHint')}
              </p>
              {projects.length === 0 ? (
                <p className="mt-2 rounded-md border border-dashed border-border px-2 py-3 text-[10px] text-muted-foreground">
                  {t('arena.needInputs')}
                </p>
              ) : (
                <div className="custom-scrollbar mt-2 flex max-h-52 flex-col gap-1 overflow-y-auto pr-1">
                  {projects.map((project) => {
                    const selected = selectedIds.includes(project.id)
                    const disabled =
                      !selected && selectedIds.length >= limit && status !== 'running' && status !== 'queued'
                    return (
                      <button
                        key={project.id}
                        type="button"
                        aria-pressed={selected}
                        disabled={disabled || status === 'running' || status === 'queued'}
                        onClick={() => toggleCandidate(project.id)}
                        className={cn(
                          'flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors',
                          selected
                            ? 'border-brand-primary/50 bg-brand-primary/10 text-foreground'
                            : 'border-border bg-background/40 text-muted-foreground hover:bg-muted/60',
                          disabled && 'cursor-not-allowed opacity-45',
                        )}
                      >
                        <span
                          className={cn(
                            'grid h-3.5 w-3.5 shrink-0 place-items-center rounded border',
                            selected ? 'border-brand-primary bg-brand-primary text-primary-foreground' : 'border-border',
                          )}
                        >
                          {selected ? <Check className="h-2.5 w-2.5" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {selectedIds.length < 2 ? (
                <p className="mt-1.5 text-[10px] text-amber-600">{t('arena.candidateNeed')}</p>
              ) : null}
            </section>

            <section className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Users className="h-3.5 w-3.5 text-brand-primary" />
                <h2 className="text-xs font-semibold">{t('arena.population')}</h2>
                <Badge tone={totalAgents > MAX_AGENTS ? 'danger' : 'neutral'} className="ml-auto font-mono tabular-nums">
                  {totalAgents} / {MAX_AGENTS}
                </Badge>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">{t('arena.populationHint')}</p>

              <div className="mt-2 flex flex-col gap-1.5">
                {rows.map((row) => (
                  <div key={row.id} className="flex items-center gap-1.5 rounded-md border border-border bg-background/40 p-1.5">
                    <SearchSelect
                      size="sm"
                      className="min-w-0 flex-1"
                      groups={groups}
                      value={row.model}
                      onValueChange={(value) => updateRow(row.id, { model: value })}
                      ariaLabel={t('arena.model')}
                      placeholder={t('arena.modelPlaceholder')}
                      emptyLabel={t('modelSlots.noMatch')}
                      disabled={status === 'running' || status === 'queued'}
                    />
                    <div className="flex shrink-0 items-center rounded-md border border-border">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="h-6 w-6 rounded-none"
                        aria-label={t('arena.decrease')}
                        disabled={row.count <= 1 || status === 'running' || status === 'queued'}
                        onClick={() => updateRow(row.id, { count: Math.max(1, row.count - 1) })}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center text-[11px] font-semibold tabular-nums">{row.count}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="h-6 w-6 rounded-none"
                        aria-label={t('arena.increase')}
                        disabled={
                          row.count >= 12 ||
                          totalAgents >= MAX_AGENTS ||
                          status === 'running' ||
                          status === 'queued'
                        }
                        onClick={() => updateRow(row.id, { count: Math.min(12, row.count + 1) })}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      aria-label={t('arena.removeRow')}
                      disabled={rows.length <= 1 || status === 'running' || status === 'queued'}
                      onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  disabled={seedPool.length === 0 || status === 'running' || status === 'queued'}
                  onClick={addRow}
                >
                  <Plus className="h-3 w-3" /> {t('arena.addModel')}
                </Button>
                <div className="ml-auto flex items-center gap-1.5">
                  <Label htmlFor="arena-temperature" className="text-[10px] text-muted-foreground">
                    {t('arena.temperature')}
                  </Label>
                  <input
                    id="arena-temperature"
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={temperature}
                    disabled={status === 'running' || status === 'queued'}
                    onChange={(event) => setTemperature(Math.max(0, Math.min(1, Number(event.target.value) || 0)))}
                    className="h-6 w-14 rounded-md border border-border bg-transparent px-1.5 text-[10px] tabular-nums"
                  />
                </div>
              </div>

              <Button
                type="button"
                className="mt-2 h-8 w-full text-[11px]"
                disabled={!ready}
                onClick={() => void start()}
              >
                {starting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Swords className="h-3.5 w-3.5" />
                )}
                {starting ? t('arena.starting') : t('arena.start')}
              </Button>
              {totalAgents > MAX_AGENTS ? (
                <p className="mt-1 text-[10px] text-destructive">{t('arena.totalTooMany')}</p>
              ) : null}
              {error ? (
                <p className="mt-1.5 flex items-start gap-1.5 text-[10px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
                </p>
              ) : null}
            </section>
          </aside>

          <section className="flex min-w-0 flex-col gap-3">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-brand-primary/10 via-card to-card p-4">
              <Swords className="pointer-events-none absolute -right-3 -bottom-4 h-24 w-24 text-brand-primary/10" aria-hidden />
              <div className="relative flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-primary">
                    {arena ? t('arena.liveStage') : t('arena.status.idle')}
                  </p>
                  <h2 className="mt-1 text-lg font-bold tracking-tight">
                    {winner
                      ? t('arena.winner', { name: winner.project.name })
                      : arena
                        ? t(arena.mode === 'duel' ? 'arena.duelHint' : 'arena.gridHint')
                        : t('arena.emptyTitle')}
                  </h2>
                  <p className="mt-1 max-w-2xl text-[11px] leading-snug text-muted-foreground">
                    {winner
                      ? t('arena.winnerHint', {
                          votes: winner.votes,
                          total: totalBallots,
                          confidence: Math.round(winner.confidence * 100),
                        })
                      : arena
                        ? t('arena.ballots', { count: totalBallots, total: arena.agents.length })
                        : t('arena.emptyBody')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="rounded-xl border border-border bg-background/60 px-3 py-1.5 text-center">
                    <p className="text-lg font-bold tabular-nums leading-none">{arena ? arena.candidates.length : selectedIds.length}</p>
                    <p className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{t('arena.candidates')}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-background/60 px-3 py-1.5 text-center">
                    <p className="text-lg font-bold tabular-nums leading-none">{arena ? arena.agents.length : totalAgents}</p>
                    <p className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{t('arena.agents')}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-background/60 px-3 py-1.5 text-center">
                    <p className="text-lg font-bold tabular-nums leading-none">{totalBallots}</p>
                    <p className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{t('arena.ballotsShort')}</p>
                  </div>
                </div>
              </div>
              {arena ? <Progress value={arena.agents.length > 0 ? (totalBallots / arena.agents.length) * 100 : 0} className="relative mt-3" label={t('arena.tally')} /> : null}
            </div>

            <div className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Crown className="h-3.5 w-3.5 text-brand-primary" />
                <h2 className="text-xs font-semibold">{t('arena.tally')}</h2>
                {arena ? (
                  <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                    {t('arena.ballots', { count: totalBallots, total: arena.agents.length })}
                  </span>
                ) : null}
              </div>
              {stageCandidates.length === 0 ? (
                <p className="mt-2 rounded-md border border-dashed border-border px-2 py-4 text-center text-[11px] text-muted-foreground">
                  {t('arena.noStage')}
                </p>
              ) : (
                <div
                  className={cn(
                    'mt-2 grid grid-cols-1 gap-2',
                    stageCandidates.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
                  )}
                >
                  {tally.map((entry) => {
                    const leading = entry.votes > 0 && entry.votes === tally[0]!.votes
                    return (
                      <div
                        key={entry.project.id}
                        className={cn(
                          'flex min-w-0 flex-col gap-1.5 rounded-lg border bg-background/40 p-2.5 transition-colors',
                          leading ? 'border-brand-primary/50 bg-brand-primary/5' : 'border-border',
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold" title={entry.project.name}>
                            {entry.project.name}
                          </span>
                          {leading ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-brand-primary">
                              <Crown className="h-2.5 w-2.5" /> {tied ? t('arena.tie') : t('arena.leading')}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-end gap-2">
                          <span className="text-2xl font-bold leading-none tabular-nums">{entry.votes}</span>
                          <span className="pb-0.5 text-[10px] tabular-nums text-muted-foreground">
                            {Math.round(entry.share * 100)}%
                          </span>
                          <span className="ml-auto pb-0.5 text-[9px] tabular-nums text-muted-foreground">
                            {t('arena.meanConfidence', { value: Math.round(entry.confidence * 100) })}
                          </span>
                        </div>
                        <Progress value={entry.share * 100} />
                        {entry.project.description ? (
                          <p className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">{entry.project.description}</p>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
              {arena && totalBallots === 0 ? (
                <p className="mt-2 text-[10px] text-muted-foreground">{t('arena.noVotes')}</p>
              ) : null}
            </div>

            <div className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Vote className="h-3.5 w-3.5 text-brand-primary" />
                <h2 className="text-xs font-semibold">{t('arena.feed')}</h2>
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{totalBallots}</span>
              </div>
              {feed.length === 0 ? (
                <p className="mt-2 rounded-md border border-dashed border-border px-2 py-4 text-center text-[11px] text-muted-foreground">
                  {t('arena.feedEmpty')}
                </p>
              ) : (
                <div className="custom-scrollbar mt-2 flex max-h-[42vh] flex-col gap-2 overflow-y-auto pr-1">
                  {feed.map((vote) => (
                    <article key={`${vote.agentId}-${vote.at}`} className="rounded-lg border border-border bg-background/40 p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-primary/10 text-brand-primary">
                          <Vote className="h-3 w-3" />
                        </span>
                        <span className="text-[11px] font-semibold">
                          {t(`arena.personas.${vote.personaId}.name`, { defaultValue: vote.agentName })}
                        </span>
                        <Badge tone="brand" className="text-[9px]">
                          {t(`arena.personas.${vote.personaId}.lens`, { defaultValue: vote.persona })}
                        </Badge>
                        <span className="font-mono text-[9px] text-muted-foreground">{vote.model}</span>
                        <span className="ml-auto text-[9px] tabular-nums text-muted-foreground">
                          {Math.round(vote.confidence * 100)}%
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] font-medium">
                        {t('arena.chose', { name: candidateNames.get(vote.chosenProjectId) ?? vote.chosenProjectId })}
                      </p>
                      <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{vote.rationale}</p>
                      {vote.rejections.length > 0 ? (
                        <ul className="mt-1 flex flex-col gap-0.5 border-t border-border/60 pt-1">
                          {vote.rejections.map((rejection) => (
                            <li key={rejection.projectId} className="text-[10px] leading-snug text-muted-foreground">
                              <span className="font-medium text-foreground/80">
                                {candidateNames.get(rejection.projectId) ?? rejection.projectId}:
                              </span>{' '}
                              {rejection.reason}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <footer className="shrink-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1800px] items-center gap-2 px-3 pt-2 pb-1">
          <div className="flex min-w-0 items-center gap-2">
            <Users className="h-3.5 w-3.5 text-brand-primary" />
            <span className="text-[11px] font-semibold">{t('arena.agentsRail')}</span>
            <span className="hidden text-[10px] text-muted-foreground sm:inline">{t('arena.agentsRailHint')}</span>
          </div>
          {agentRows.length > 0 ? (
            <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
              {t('arena.agentPosition', { index: Math.min(activeAgent + 1, agentRows.length), total: agentRows.length })}
            </span>
          ) : null}
          <button
            type="button"
            aria-label={t('arena.previousAgent')}
            disabled={activeAgent === 0}
            onClick={() => swiperRef.current?.slidePrev()}
            className="grid h-6 w-6 place-items-center rounded-full border border-border bg-background text-foreground shadow-sm disabled:opacity-30"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={t('arena.nextAgent')}
            disabled={agentRows.length === 0 || activeAgent >= agentRows.length - 1}
            onClick={() => swiperRef.current?.slideNext()}
            className="grid h-6 w-6 place-items-center rounded-full border border-border bg-background text-foreground shadow-sm disabled:opacity-30"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mx-auto w-full max-w-[1800px] px-2 pb-2">
          {agentRows.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-[11px] text-muted-foreground">
              <Circle className="h-3 w-3" /> {t('arena.railEmpty')}
            </div>
          ) : (
            <Swiper
              modules={[A11y]}
              slidesPerView="auto"
              spaceBetween={8}
              onSwiper={(swiper) => {
                swiperRef.current = swiper
              }}
              onSlideChange={(swiper) => setActiveAgent(swiper.activeIndex)}
              className="w-full"
            >
              {agentRows.map(({ agent, vote, error: agentError, state, stalled }) => (
                <SwiperSlide key={agent.id} className="!w-[286px] !h-auto">
                  <AgentCard
                    agent={agent}
                    vote={vote}
                    error={agentError}
                    state={state}
                    stalled={stalled}
                    candidateNames={candidateNames}
                  />
                </SwiperSlide>
              ))}
            </Swiper>
          )}
        </div>
      </footer>
    </div>
  )
}

function AgentCard({
  agent,
  vote,
  error,
  state,
  stalled = false,
  candidateNames,
}: {
  agent: ArenaAgent
  vote?: ArenaVote
  error?: string
  state: AgentState
  /** The arena closed before this voter returned a ballot. */
  stalled?: boolean
  candidateNames: Map<string, string>
}) {
  const { t } = useTranslation()
  const name = t(`arena.personas.${agent.personaId}.name`, { defaultValue: agent.name })
  const lens = t(`arena.personas.${agent.personaId}.lens`, { defaultValue: agent.lens })
  return (
    <div
      className={cn(
        'flex h-full min-h-[132px] flex-col rounded-xl border bg-card p-2.5 shadow-sm transition-colors',
        state === 'active' && 'border-brand-primary/60 ring-1 ring-brand-primary/20',
        state === 'done' && 'border-emerald-500/40',
        state === 'error' && 'border-destructive/40',
        state === 'idle' && 'border-border',
      )}
    >
      <div className="flex items-center gap-1.5">
        <AgentStatusIcon state={state} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{name}</span>
        <Badge tone={state === 'done' ? 'success' : state === 'active' ? 'brand' : state === 'error' ? 'danger' : 'neutral'} className="text-[9px]">
          {lens}
        </Badge>
      </div>
      <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
        {agent.model.provider}:{agent.model.model}
      </p>

      {vote ? (
        <div className="mt-1 flex min-h-0 flex-1 flex-col gap-1">
          <p className="text-[11px] font-medium leading-tight">
            {t('arena.chose', { name: candidateNames.get(vote.chosenProjectId) ?? vote.chosenProjectId })}
          </p>
          <p className="custom-scrollbar max-h-12 overflow-y-auto pr-1 text-[10px] leading-snug text-muted-foreground">
            {vote.rationale}
          </p>
          {vote.rejections.length > 0 ? (
            <details className="mt-auto text-[10px] text-muted-foreground">
              <summary className="cursor-pointer select-none text-[9px] uppercase tracking-wide">
                {t('arena.against', { count: vote.rejections.length })}
              </summary>
              <ul className="custom-scrollbar mt-1 flex max-h-16 flex-col gap-0.5 overflow-y-auto pr-1">
                {vote.rejections.map((rejection) => (
                  <li key={rejection.projectId} className="leading-snug">
                    <span className="font-medium text-foreground/80">
                      {candidateNames.get(rejection.projectId) ?? rejection.projectId}:
                    </span>{' '}
                    {rejection.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : error ? (
        <p className="mt-1 text-[10px] leading-snug text-destructive">{t('arena.failed')} {error}</p>
      ) : (
        <p className="mt-1 flex items-start gap-1.5 text-[10px] leading-snug text-muted-foreground">
          {state === 'active' ? <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" /> : null}
          {state === 'active' ? t('arena.thinking') : stalled ? t('arena.stalled') : t('arena.waiting')}
        </p>
      )}
    </div>
  )
}
