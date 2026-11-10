'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  BarChart3,
  Download,
  History,
  Layers,
  Network,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  Checkbox,
  Label,
  cn,
} from '@verdict/ui'
import {
  reasoningEffortsFor,
  type AgentPool,
  type ModelRef,
  type ProjectConsensus,
  type ProjectEvaluation,
  type ProjectRevision,
  type ProjectVerification,
  type ProviderInfo,
  type Report,
  type RunEvent,
  type RunSnapshot,
  type RunStatus,
} from '@verdict/shared'
import {
  createRun,
  cancelRun,
  fetchProviders,
  fetchRun,
  previewInputs,
  subscribeRun,
  type PreviewResponse,
  type RunRequest,
} from '@/lib/api'
import { deleteRun, listRuns, loadSettings, saveRun, saveSettings, type StoredRun } from '@/lib/idb'
import { formatDate } from '@/lib/format'
import { useProcessingFavicon } from '@/hooks/use-processing-favicon'
import { UploadCard } from './upload-card'
import { ModelSlots } from './model-slots'
import { PipelineGraph, StatusPill } from './pipeline-graph'
import { ResultsPanel } from './results-panel'
import { EventLog } from './event-log'
import { AppearanceMenu } from './appearance-menu'
import { LanguageMenu } from './language-menu'
import { SectionCard } from './section-card'

const RUNNING: RunStatus[] = ['queued', 'parsing', 'harvesting', 'evaluating', 'reviewing', 'consensus', 'verifying']

interface WorkspaceSettings {
  evaluatorModels: ModelRef[]
  verifierModels: ModelRef[]
  showRanks: boolean
  maxVideoMinutes: number
  temperature: number
}

interface LiveState {
  evaluations: ProjectEvaluation[]
  revisions: ProjectRevision[]
  consensus: ProjectConsensus[]
  verifications: ProjectVerification[]
  report?: Report
}

const EMPTY_LIVE: LiveState = { evaluations: [], revisions: [], consensus: [], verifications: [] }

function flatModels(providers: ProviderInfo[]): ModelRef[] {
  return providers
    .filter((provider) => provider.configured)
    .flatMap((provider) => provider.models.map((model) => ({ provider: provider.id, model: model.id })))
}

function fillModels(pool: ModelRef[], size: number): ModelRef[] {
  if (pool.length === 0) return []
  return Array.from({ length: size }, (_, index) => ({ ...pool[index % pool.length]! }))
}

/** Keep saved refs that still exist in the configured catalog; drop the rest. */
function sanitizeModels(models: ModelRef[], providers: ProviderInfo[]): ModelRef[] {
  const catalog = new Map(
    providers
      .filter((provider) => provider.configured)
      .map((provider) => [provider.id, new Set(provider.models.map((model) => model.id))] as const),
  )
  return models
    .filter((ref) => catalog.get(ref.provider)?.has(ref.model) ?? false)
    .map((ref) => {
      if (ref.reasoningEffort && !reasoningEffortsFor(ref.provider, ref.model).includes(ref.reasoningEffort)) {
        return { provider: ref.provider, model: ref.model }
      }
      return { ...ref }
    })
}

/** Drop pool entries whose provider has no key, so a stale env never seeds a dead slot. */
function usablePool(pool: ModelRef[], providers: ProviderInfo[]): ModelRef[] {
  const configured = new Set(providers.filter((provider) => provider.configured).map((provider) => provider.id))
  const filtered = pool.filter((ref) => configured.has(ref.provider))
  return filtered.length > 0 ? filtered : flatModels(providers)
}

function upsert<T>(items: T[], next: T, key: (entry: T) => string): T[] {
  const index = items.findIndex((entry) => key(entry) === key(next))
  if (index < 0) return [...items, next]
  const copy = [...items]
  copy[index] = next
  return copy
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function VerdictWorkspace() {
  const { t } = useTranslation()
  const [providers, setProviders] = React.useState<ProviderInfo[]>([])
  const [defaults, setDefaults] = React.useState<{ evaluators: ModelRef[]; verifiers: ModelRef[] }>({
    evaluators: [],
    verifiers: [],
  })
  const [agents, setAgents] = React.useState<AgentPool>()
  const [providersError, setProvidersError] = React.useState<string | null>(null)

  const [manifestText, setManifestText] = React.useState('')
  const [manifestName, setManifestName] = React.useState<string | undefined>()
  const [rulesText, setRulesText] = React.useState('')
  const [rulesName, setRulesName] = React.useState<string | undefined>()
  const [rubricText, setRubricText] = React.useState('')
  const [rubricName, setRubricName] = React.useState<string | undefined>()
  const [rubricMode, setRubricMode] = React.useState<'builtin' | 'custom'>('builtin')

  const [preview, setPreview] = React.useState<PreviewResponse | null>(null)
  const [previewError, setPreviewError] = React.useState<string | null>(null)

  const [evaluatorModels, setEvaluatorModels] = React.useState<ModelRef[]>([])
  const [verifierModels, setVerifierModels] = React.useState<ModelRef[]>([])
  const [showRanks, setShowRanks] = React.useState(false)
  const [anchors, setAnchors] = React.useState<string[]>([])
  const [anchorQuery, setAnchorQuery] = React.useState('')
  const [maxVideoMinutes, setMaxVideoMinutes] = React.useState(20)
  const [temperature, setTemperature] = React.useState(0.2)

  const [runId, setRunId] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<RunStatus | undefined>()
  const [events, setEvents] = React.useState<RunEvent[]>([])
  const [live, setLive] = React.useState<LiveState>(EMPTY_LIVE)
  const [runError, setRunError] = React.useState<string | null>(null)
  const [starting, setStarting] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | undefined>()

  const [history, setHistory] = React.useState<StoredRun[]>([])
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [logOpen, setLogOpen] = React.useState(false)
  const [view, setView] = React.useState<'pipeline' | 'results'>('pipeline')
  const [restored, setRestored] = React.useState(false)

  const unsubscribe = React.useRef<(() => void) | null>(null)
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const running = status !== undefined && RUNNING.includes(status)

  // A pulsing dot on the tab favicon while the pipeline is active, so a long
  // run stays visible from another tab.
  useProcessingFavicon(running)

  // Providers
  React.useEffect(() => {
    let cancelled = false
    fetchProviders()
      .then((result) => {
        if (cancelled) return
        setProviders(result.providers)
        setDefaults(result.defaults)
        setAgents(result.agents)
        setProvidersError(null)
      })
      .catch((error) => {
        if (!cancelled) setProvidersError(messageOf(error))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Restore the last workspace configuration once providers are known.
  React.useEffect(() => {
    if (providers.length === 0 || restored) return
    let cancelled = false
    void (async () => {
      const saved = await loadSettings<WorkspaceSettings>()
      if (cancelled) return
      const evalPool = usablePool(defaults.evaluators, providers)
      const verifierPool = usablePool(defaults.verifiers, providers)
      if (saved) {
        const savedEvaluators = sanitizeModels(saved.evaluatorModels, providers)
        const savedVerifiers = sanitizeModels(saved.verifierModels, providers)
        setEvaluatorModels(savedEvaluators.length > 0 ? savedEvaluators : fillModels(evalPool, 6))
        setVerifierModels(savedVerifiers.length > 0 ? savedVerifiers : fillModels(verifierPool, 2))
        setShowRanks(saved.showRanks)
        setMaxVideoMinutes(saved.maxVideoMinutes)
        setTemperature(saved.temperature)
      } else {
        setEvaluatorModels(fillModels(evalPool, 6))
        setVerifierModels(fillModels(verifierPool, 2))
      }
      setRestored(true)
      setHistory(await listRuns())
    })()
    return () => {
      cancelled = true
    }
  }, [providers, defaults, restored])

  // Persist configuration (best effort, localStorage-free).
  React.useEffect(() => {
    if (!restored) return
    void saveSettings({ evaluatorModels, verifierModels, showRanks, maxVideoMinutes, temperature } satisfies WorkspaceSettings)
  }, [evaluatorModels, verifierModels, showRanks, maxVideoMinutes, temperature, restored])

  // Debounced validation preview.
  React.useEffect(() => {
    if (!manifestText.trim()) {
      setPreview(null)
      setPreviewError(null)
      return
    }
    const timer = setTimeout(() => {
      void previewInputs({
        manifestText,
        ...(rubricText.trim() ? { rubricText, rubricFilename: rubricName } : {}),
        rulesText,
      })
        .then((result) => {
          setPreview(result)
          setPreviewError(null)
        })
        .catch((error) => {
          setPreview(null)
          setPreviewError(messageOf(error))
        })
    }, 450)
    return () => clearTimeout(timer)
  }, [manifestText, rubricText, rubricName, rulesText])

  React.useEffect(() => () => unsubscribe.current?.(), [])

  const loadPreset = async (label: string, url: string, kind: 'manifest' | 'rules' | 'rubric') => {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(t('inputs.presetError', { label, status: response.status }))
      const text = await response.text()
      const filename = url.split('/').pop() ?? label
      if (kind === 'manifest') {
        setManifestText(text)
        setManifestName(filename)
      } else if (kind === 'rules') {
        setRulesText(text)
        setRulesName(filename)
      } else {
        setRubricText(text)
        setRubricName(filename)
        setRubricMode('custom')
      }
    } catch (error) {
      setPreviewError(messageOf(error))
    }
  }

  const applyEvent = (event: RunEvent) => {
    setEvents((previous) => [...previous, event])
    switch (event.type) {
      case 'stage':
        if (event.message) setStatus(event.message as RunStatus)
        break
      case 'evaluation': {
        const evaluation = event.data as ProjectEvaluation
        setLive((previous) => ({ ...previous, evaluations: upsert(previous.evaluations, evaluation, (entry) => `${entry.projectId}:${entry.agentId}`) }))
        break
      }
      case 'revision': {
        const revision = event.data as ProjectRevision
        setLive((previous) => ({ ...previous, revisions: upsert(previous.revisions, revision, (entry) => `${entry.projectId}:${entry.agentId}`) }))
        break
      }
      case 'consensus': {
        const consensus = event.data as ProjectConsensus
        setLive((previous) => ({ ...previous, consensus: upsert(previous.consensus, consensus, (entry) => entry.projectId) }))
        break
      }
      case 'verification': {
        const verification = event.data as ProjectVerification
        setLive((previous) => ({
          ...previous,
          verifications: upsert(previous.verifications, verification, (entry) => `${entry.projectId}:${entry.verifierId}`),
        }))
        break
      }
      case 'report': {
        const report = event.data as Report
        setLive((previous) => ({ ...previous, report }))
        setStatus('done')
        setSelectedId((current) => current ?? report.rankings[0]?.entries[0]?.projectId)
        break
      }
      case 'error':
        setRunError(event.message ?? t('run.failed'))
        setStatus('failed')
        break
      default:
        break
    }
  }

  const refreshRun = async (id: string) => {
    try {
      const snapshot: RunSnapshot = await fetchRun(id)
      setStatus(snapshot.status)
      setEvents(snapshot.events)
      setLive({
        evaluations: snapshot.evaluations,
        revisions: snapshot.revisions,
        consensus: snapshot.consensus,
        verifications: snapshot.verifications,
        ...(snapshot.report ? { report: snapshot.report } : {}),
      })
      setSelectedId((current) => current ?? snapshot.report?.rankings[0]?.entries[0]?.projectId ?? snapshot.manifest[0]?.id)
      if (snapshot.error) setRunError(snapshot.error)
      if (snapshot.report) {
        await saveRun({
          id: snapshot.id,
          createdAt: snapshot.createdAt,
          status: snapshot.status,
          savedAt: new Date().toISOString(),
          summary: {
            projects: snapshot.manifest.length,
            rubric: snapshot.rubric.name,
            tracks: snapshot.report.rankings.length,
          },
          snapshot,
        })
        setHistory(await listRuns())
      }
    } catch {
      /* a transient fetch failure is harmless; the SSE stream keeps updating */
    }
  }

  const startRun = async () => {
    if (starting || running) return
    setStarting(true)
    setRunError(null)
    setEvents([])
    setLive(EMPTY_LIVE)
    setStatus('queued')
    setView('pipeline')
    unsubscribe.current?.()
    try {
      const payload: RunRequest = {
        manifestText,
        manifestFilename: manifestName ?? 'manifest.json',
        rulesText,
        rulesFilename: rulesName ?? 'rules.md',
        ...(rubricText.trim() ? { rubricText, rubricFilename: rubricName ?? 'rubric.yaml' } : {}),
        options: {
          evaluatorModels,
          verifierModels,
          showRanksToAgents: showRanks,
          anchors,
          maxRounds: 2,
          temperature,
          concurrency: 2,
          maxVideoMinutes,
          frameIntervalSeconds: 20,
        },
      }
      const run = await createRun(payload)
      setRunId(run.id)
      setStatus(run.status as RunStatus)
      unsubscribe.current = subscribeRun(
        run.id,
        (event) => {
          applyEvent(event)
          if (event.type === 'report') {
            if (refreshTimer.current) clearTimeout(refreshTimer.current)
            refreshTimer.current = setTimeout(() => void refreshRun(run.id), 250)
          }
        },
        () => {
          if (refreshTimer.current) clearTimeout(refreshTimer.current)
          refreshTimer.current = setTimeout(() => void refreshRun(run.id), 400)
        },
      )
    } catch (error) {
      setRunError(messageOf(error))
      setStatus('failed')
    } finally {
      setStarting(false)
    }
  }

  const stopRun = async () => {
    if (!runId) return
    try {
      await cancelRun(runId)
      setStatus('cancelled')
    } catch (error) {
      setRunError(messageOf(error))
    }
  }

  const exportReport = () => {
    if (!live.report) return
    const blob = new Blob([JSON.stringify(live.report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `verdict-${live.report.runId}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const restoreSnapshot = (entry: StoredRun) => {
    const snapshot = entry.snapshot as RunSnapshot
    unsubscribe.current?.()
    setRunId(snapshot.id)
    setManifestText(JSON.stringify(snapshot.manifest, null, 2))
    setRulesText(snapshot.rules)
    setRubricText(JSON.stringify(snapshot.rubric, null, 2))
    setRubricName(`${snapshot.rubric.name}.json`)
    setRubricMode('custom')
    setEvaluatorModels(snapshot.options.evaluatorModels)
    setVerifierModels(snapshot.options.verifierModels)
    setShowRanks(snapshot.options.showRanksToAgents)
    setAnchors(snapshot.options.anchors)
    setMaxVideoMinutes(snapshot.options.maxVideoMinutes)
    setTemperature(snapshot.options.temperature)
    setStatus(snapshot.status)
    setEvents(snapshot.events)
    setRunError(snapshot.error ?? null)
    setLive({
      evaluations: snapshot.evaluations,
      revisions: snapshot.revisions,
      consensus: snapshot.consensus,
      verifications: snapshot.verifications,
      ...(snapshot.report ? { report: snapshot.report } : {}),
    })
    setSelectedId(snapshot.report?.rankings[0]?.entries[0]?.projectId)
    setHistoryOpen(false)
  }

  const removeSaved = async (id: string) => {
    await deleteRun(id)
    setHistory(await listRuns())
  }

  const projects = preview?.projects ?? []
  const anchorNeedle = anchorQuery.trim().toLowerCase()
  const anchorMatches = anchorNeedle
    ? projects.filter((project) => project.name.toLowerCase().includes(anchorNeedle))
    : projects
  const criteria = preview?.rubric.criteria ?? live.report?.criteria ?? []
  const hasResults =
    Boolean(live.report) || live.consensus.length > 0 || live.evaluations.length > 0 || live.verifications.length > 0
  const canToggleView = Boolean(runId) && hasResults
  const toggleAnchor = (id: string) => {
    setAnchors((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : current.length >= 3 ? current : [...current, id]))
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="" width={28} height={28} className="h-7 w-7" />
          <div className="leading-none">
            <p className="text-[13px] font-bold tracking-tight">Verdict</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{t('app.tagline')}</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setHistoryOpen((value) => !value)}>
            <History className="h-3.5 w-3.5" /> {t('app.history')}
            {history.length > 0 ? <span className="tabular-nums text-muted-foreground">({history.length})</span> : null}
          </Button>
          <LanguageMenu />
          <AppearanceMenu />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-2 px-2 pt-2">
        <SectionCard
          title={t('inputs.title')}
          icon={<Layers className="h-3.5 w-3.5 text-brand-primary" />}
          aside={
            <span className="ml-auto flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span>{t('inputs.projectCount', { count: projects.length })}</span>
              {preview ? <span>{t('inputs.ruleChars', { count: preview.rulesChars.toLocaleString() })}</span> : null}
            </span>
          }
          contentClassName="flex flex-col gap-3 pt-0"
        >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <UploadCard
                id="manifest"
                label={t('inputs.manifestLabel')}
                hint={t('inputs.manifestHint')}
                accept=".json,.yaml,.yml,application/json,text/yaml"
                filename={manifestName}
                text={manifestText}
                required
                onFile={(filename, text) => {
                  setManifestText(text)
                  setManifestName(filename)
                }}
                onClear={() => {
                  setManifestText('')
                  setManifestName(undefined)
                }}
              />

              <UploadCard
                id="rules"
                label={t('inputs.rulesLabel')}
                hint={t('inputs.rulesHint')}
                accept=".md,.markdown,.txt,.yaml,.yml"
                filename={rulesName}
                text={rulesText}
                onFile={(filename, text) => {
                  setRulesText(text)
                  setRulesName(filename)
                }}
                onClear={() => {
                  setRulesText('')
                  setRulesName(undefined)
                }}
              />

              <UploadCard
                id="rubric"
                label={t('inputs.rubricLabel')}
                hint={t('inputs.rubricHint')}
                accept=".yaml,.yml,.json,.md,.markdown"
                filename={rubricName}
                text={rubricText}
                actions={
                  <>
                    <Button
                      type="button"
                      variant={rubricMode === 'builtin' ? 'primary' : 'outline'}
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => {
                        setRubricText('')
                        setRubricName(undefined)
                        setRubricMode('builtin')
                      }}
                    >
                      {t('inputs.builtIn')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => void loadPreset('generic', '/rules/judging-rubric.generic.yaml', 'rubric')}
                    >
                      {t('inputs.genericYaml')}
                    </Button>
                  </>
                }
                onFile={(filename, text) => {
                  setRubricText(text)
                  setRubricName(filename)
                  setRubricMode('custom')
                }}
                onClear={() => {
                  setRubricText('')
                  setRubricName(undefined)
                  setRubricMode('builtin')
                }}
              />
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-2.5">
              {previewError ? (
                <p className="flex items-start gap-1.5 text-[11px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {previewError}
                </p>
              ) : null}
              {preview ? (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="success">{t('inputs.rubricBadge', { name: preview.rubric.name })}</Badge>
                    {criteria.map((criterion) => (
                      <Badge key={criterion.id} tone="neutral">
                        {criterion.label} · {Math.round(criterion.weight * 100)}%
                      </Badge>
                    ))}
                  </div>
                  {preview.warnings.length > 0 ? (
                    <ul className="list-inside list-disc text-[10px] text-amber-600">
                      {preview.warnings.slice(0, 6).map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                  {projects.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t('inputs.anchors')}
                        </Label>
                        <span className="text-[10px] tabular-nums text-muted-foreground">{anchors.length}/3</span>
                        {projects.length > 3 ? (
                          <div className="relative ml-auto min-w-[8rem] flex-1 sm:max-w-[13rem]">
                            <Search
                              className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <input
                              value={anchorQuery}
                              onChange={(event) => setAnchorQuery(event.target.value)}
                              placeholder={t('inputs.anchorFilter')}
                              aria-label={t('inputs.anchorFilter')}
                              className="h-6 w-full rounded-full border border-border bg-transparent pl-6 pr-2 text-[10px] text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                            />
                          </div>
                        ) : null}
                      </div>
                      <div className="custom-scrollbar flex max-h-20 flex-wrap content-start gap-1.5 overflow-y-auto">
                        {anchorMatches.map((project) => (
                          <button
                            key={project.id}
                            type="button"
                            onClick={() => toggleAnchor(project.id)}
                            title={project.name}
                            className={cn(
                              'inline-flex max-w-[12rem] items-center rounded-full border px-2 py-0.5 text-[10px]',
                              anchors.includes(project.id)
                                ? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
                                : 'border-border text-muted-foreground hover:bg-muted',
                            )}
                          >
                            <span className="truncate">{project.name}</span>
                          </button>
                        ))}
                        {anchorMatches.length === 0 ? (
                          <span className="text-[10px] text-muted-foreground">{t('inputs.anchorNoMatch')}</span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : !previewError ? (
                <p className="text-[11px] text-muted-foreground">{t('inputs.chooseManifest')}</p>
              ) : null}
            </div>
        </SectionCard>

        <SectionCard
          title={t('models.title')}
          icon={<Settings2 className="h-3.5 w-3.5 text-brand-primary" />}
          aside={<span className="ml-auto text-[10px] text-muted-foreground">{t('models.aside')}</span>}
          contentClassName="grid grid-cols-1 gap-4 pt-0 md:grid-cols-2"
        >
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('models.evaluators')}</Label>
              <span className="text-[10px] text-muted-foreground">{t('models.allCriteria')}</span>
            </div>
            <ModelSlots providers={providers} value={evaluatorModels} slots={6} onChange={setEvaluatorModels} idPrefix="eval" compact />
          </div>

          <div className="flex min-w-0 flex-col gap-2 md:border-l md:border-border md:pl-4">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('models.verifiers')}</Label>
              <span className="text-[10px] text-muted-foreground">{t('models.auditFinal')}</span>
            </div>
            <ModelSlots providers={providers} value={verifierModels} slots={2} onChange={setVerifierModels} idPrefix="verify" compact />

            <div className="mt-1 h-px bg-border" />

            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('models.options')}</Label>
              <span className="text-[10px] text-muted-foreground">{t('models.rankingHarvest')}</span>
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2">
              <Checkbox checked={showRanks} onCheckedChange={(value) => setShowRanks(value === true)} className="mt-0.5" />
              <span>
                <span className="block text-[11px] font-medium">{t('models.showRanks')}</span>
                <span className="block text-[10px] leading-tight text-muted-foreground">
                  {t('models.showRanksHint')}
                </span>
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="video-cap" className="text-[10px] text-muted-foreground">
                  {t('models.maxVideo')}
                </Label>
                <input
                  id="video-cap"
                  type="number"
                  min={1}
                  max={120}
                  value={maxVideoMinutes}
                  onChange={(event) => setMaxVideoMinutes(Math.max(1, Math.min(120, Number(event.target.value) || 20)))}
                  className="h-7 rounded-md border border-border bg-transparent px-2 text-[11px] tabular-nums"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="temperature" className="text-[10px] text-muted-foreground">
                  {t('models.temperature')}
                </Label>
                <input
                  id="temperature"
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={temperature}
                  onChange={(event) => setTemperature(Math.max(0, Math.min(1, Number(event.target.value) || 0)))}
                  className="h-7 rounded-md border border-border bg-transparent px-2 text-[11px] tabular-nums"
                />
              </div>
            </div>
            <p className="text-[10px] leading-tight text-muted-foreground">
              {t('models.persistence')}
            </p>
          </div>

          {providersError ? (
            <p className="text-[10px] text-destructive md:col-span-2">{t('models.apiError', { error: providersError })}</p>
          ) : null}
        </SectionCard>

        {runId && view === 'pipeline' ? (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-1 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('pipeline.title')}</span>
              <span className="text-[10px] text-muted-foreground">{t('pipeline.hint')}</span>
            </div>
            <PipelineGraph
              status={status}
              evaluations={live.evaluations}
              revisions={live.revisions}
              verifications={live.verifications}
              agents={agents}
              evaluatorModels={evaluatorModels}
              verifierModels={verifierModels}
              criteria={criteria}
              projects={projects}
              selectedProjectId={selectedId}
              hasReport={Boolean(live.report)}
              failed={status === 'failed'}
            />
          </div>
        ) : null}

        {hasResults && view === 'results' ? (
          <div className="h-[min(72vh,780px)] min-h-[540px]">
            <ResultsPanel
              report={live.report}
              rubric={preview?.rubric}
              manifest={projects}
              consensus={live.consensus}
              evaluations={live.evaluations}
              verifications={live.verifications}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        ) : null}

        <div className="sticky bottom-0 z-20 -mx-2 mt-auto flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-2 py-2 backdrop-blur">
          {running ? (
            <Button type="button" variant="destructive" onClick={() => void stopRun()}>
              <Square className="h-4 w-4" /> {t('run.cancel')}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!manifestText.trim() || evaluatorModels.length === 0 || verifierModels.length === 0 || starting}
              onClick={() => void startRun()}
            >
              <Play className="h-4 w-4" /> {starting ? t('run.starting') : t('run.evaluate')}
            </Button>
          )}
          <Button type="button" variant="outline" size="icon" aria-label={t('run.refresh')} disabled={!runId} onClick={() => runId && void refreshRun(runId)}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label={t('run.export')} disabled={!live.report} onClick={exportReport}>
            <Download className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={logOpen ? 'secondary' : 'outline'}
            size="icon"
            aria-label={t('run.log')}
            aria-pressed={logOpen}
            onClick={() => setLogOpen((value) => !value)}
          >
            <Terminal className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={view === 'results' ? 'secondary' : 'outline'}
            size="icon"
            aria-label={view === 'pipeline' ? t('run.showResults') : t('run.showPipeline')}
            title={view === 'pipeline' ? t('run.showResults') : t('run.showPipeline')}
            disabled={!canToggleView}
            onClick={() => setView((current) => (current === 'pipeline' ? 'results' : 'pipeline'))}
          >
            {view === 'pipeline' ? <BarChart3 className="h-4 w-4" /> : <Network className="h-4 w-4" />}
          </Button>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
            <StatusPill status={status} />
            {runError ? <span className="min-w-0 truncate text-[10px] text-destructive">{runError}</span> : null}
            {!runError && live.report ? (
              <span className="text-[10px] text-muted-foreground">{t('run.reportReady', { date: formatDate(live.report.createdAt) })}</span>
            ) : null}
          </div>
        </div>
      </main>

      {logOpen ? (
        <div className="fixed bottom-16 right-3 z-40 h-[min(45vh,420px)] w-[min(92vw,440px)] shadow-2xl">
          <EventLog events={events} onClose={() => setLogOpen(false)} />
        </div>
      ) : null}

      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setHistoryOpen(false)}>
          <div
            className="custom-scrollbar flex h-full w-full max-w-sm flex-col border-l border-border bg-card p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <History className="h-4 w-4" />
              <h2 className="text-sm font-semibold">{t('history.title')}</h2>
              <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" aria-label={t('history.close')} onClick={() => setHistoryOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">{t('history.stored')}</p>
            <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
              {history.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">{t('history.empty')}</p>
              ) : (
                history.map((entry) => (
                  <div key={entry.id} className="rounded-md border border-border p-2">
                    <button type="button" className="w-full text-left" onClick={() => restoreSnapshot(entry)}>
                      <p className="truncate text-[11px] font-medium">{entry.summary.rubric}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {formatDate(entry.createdAt)} · {t('history.projects', { count: entry.summary.projects })} ·{' '}
                        {t('history.tracks', { count: entry.summary.tracks })}
                      </p>
                      <p className="mt-0.5 text-[10px] capitalize text-muted-foreground">
                        {t(`status.${entry.status}`, { defaultValue: entry.status })}
                      </p>
                    </button>
                    <div className="mt-1 flex justify-end">
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-destructive" onClick={() => void removeSaved(entry.id)}>
                        <Trash2 className="h-3 w-3" /> {t('history.delete')}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
