'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  BarChart3,
  Download,
  History,
  Layers,
  Loader2,
  Network,
  Pause,
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
  Skeleton,
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
  pauseRun,
  previewInputs,
  resumeRun,
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
import { EventLog, LogPeek, type LogDock } from './event-log'
import { AppearanceMenu } from './appearance-menu'
import { LanguageMenu } from './language-menu'
import { SectionCard } from './section-card'

const RUNNING: RunStatus[] = ['queued', 'parsing', 'harvesting', 'evaluating', 'reviewing', 'consensus', 'verifying']

interface WorkspaceSettings {
  evaluatorModels: ModelRef[]
  verifierModels: ModelRef[]
  showRanks: boolean
  cacheResources: boolean
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

const DOCK_PANEL_CLASS: Record<LogDock, string> = {
  top: 'h-[min(34vh,320px)] w-full border-b',
  bottom: 'h-[min(34vh,320px)] w-full border-t',
  left: 'h-full w-[min(92vw,420px)] border-r',
  right: 'h-full w-[min(92vw,420px)] border-l',
}

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
  const [previewing, setPreviewing] = React.useState(false)

  const [evaluatorModels, setEvaluatorModels] = React.useState<ModelRef[]>([])
  const [verifierModels, setVerifierModels] = React.useState<ModelRef[]>([])
  const [showRanks, setShowRanks] = React.useState(false)
  const [cacheResources, setCacheResources] = React.useState(true)
  const [anchors, setAnchors] = React.useState<string[]>([])
  const [anchorQuery, setAnchorQuery] = React.useState('')
  const [maxVideoMinutes, setMaxVideoMinutes] = React.useState(20)
  const [temperature, setTemperature] = React.useState(0.2)

  const [runId, setRunId] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<RunStatus | undefined>()
  const [events, setEvents] = React.useState<RunEvent[]>([])
  // Clearing the log only hides the lines already shown: new events keep
  // streaming, and a fresh run starts from zero again.
  const [clearedEvents, setClearedEvents] = React.useState(0)
  const [live, setLive] = React.useState<LiveState>(EMPTY_LIVE)
  const [runError, setRunError] = React.useState<string | null>(null)
  const [starting, setStarting] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [paused, setPaused] = React.useState(false)
  const [pausing, setPausing] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | undefined>()

  const [history, setHistory] = React.useState<StoredRun[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(true)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [inputsOpen, setInputsOpen] = React.useState(true)
  const [modelsOpen, setModelsOpen] = React.useState(true)
  const [logOpen, setLogOpen] = React.useState(false)
  const [logReduced, setLogReduced] = React.useState(false)
  const [logDock, setLogDock] = React.useState<LogDock>('bottom')
  const [view, setView] = React.useState<'pipeline' | 'results'>('pipeline')
  const [restored, setRestored] = React.useState(false)

  const unsubscribe = React.useRef<(() => void) | null>(null)
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const running = status !== undefined && RUNNING.includes(status)

  const refreshHistory = React.useCallback(async () => {
    setHistoryLoading(true)
    try {
      setHistory(await listRuns())
    } catch {
      // IndexedDB can be unavailable (private window, quota): keep the last list.
    } finally {
      setHistoryLoading(false)
    }
  }, [])

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
        setCacheResources(saved.cacheResources ?? true)
        setMaxVideoMinutes(saved.maxVideoMinutes)
        setTemperature(saved.temperature)
      } else {
        setEvaluatorModels(fillModels(evalPool, 6))
        setVerifierModels(fillModels(verifierPool, 2))
      }
      setRestored(true)
    })()
    return () => {
      cancelled = true
    }
  }, [providers, defaults, restored])

  // Load saved runs on mount, independently of the provider fetch: a provider
  // outage must not leave the history drawer stuck on its skeleton.
  React.useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  // Persist configuration (best effort, localStorage-free).
  React.useEffect(() => {
    if (!restored) return
    void saveSettings({ evaluatorModels, verifierModels, showRanks, cacheResources, maxVideoMinutes, temperature } satisfies WorkspaceSettings)
  }, [evaluatorModels, verifierModels, showRanks, cacheResources, maxVideoMinutes, temperature, restored])

  // Debounced validation preview.
  React.useEffect(() => {
    if (!manifestText.trim()) {
      setPreview(null)
      setPreviewError(null)
      setPreviewing(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setPreviewing(true)
      void previewInputs({
        manifestText,
        ...(rubricText.trim() ? { rubricText, rubricFilename: rubricName } : {}),
        rulesText,
      })
        .then((result) => {
          if (cancelled) return
          setPreview(result)
          setPreviewError(null)
        })
        .catch((error) => {
          if (cancelled) return
          setPreview(null)
          setPreviewError(messageOf(error))
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false)
        })
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
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
        if (event.message === 'Run cancelled.') {
          setStatus('cancelled')
          break
        }
        setRunError(event.message ?? t('run.failed'))
        setStatus('failed')
        break
      default:
        break
    }
  }

  const refreshRun = React.useCallback(
    async (id: string, manual = false) => {
      if (manual) setRefreshing(true)
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
        setPaused(Boolean(snapshot.paused))
        // A cancelled run reports "Run cancelled." as its error; that is a user
        // action, not a failure, so it must not raise the red banner.
        if (snapshot.status === 'cancelled') setRunError(null)
        else if (snapshot.error) setRunError(snapshot.error)
        else if (snapshot.status !== 'failed') setRunError(null)
        if (['done', 'failed', 'cancelled'].includes(snapshot.status)) {
          unsubscribe.current?.()
          unsubscribe.current = null
        }
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
          await refreshHistory()
        }
      } catch (error) {
        const message = messageOf(error)
        if (/not found|404/i.test(message)) {
          unsubscribe.current?.()
          unsubscribe.current = null
          setRunError(t('run.lost'))
          setStatus('failed')
        } else if (manual) {
          setRunError(message)
        }
        // A transient failure is harmless while the SSE stream or the poll is
        // still running; the next tick retries.
      } finally {
        if (manual) setRefreshing(false)
      }
    },
    [refreshHistory, t],
  )

  // If the SSE stream drops (a restart, a proxy, a laptop waking up), the run
  // keeps going server-side. Poll the snapshot until it reaches a terminal
  // status so the pipeline never freezes on a stale stage.
  React.useEffect(() => {
    if (!runId || !running) return
    const timer = setInterval(() => void refreshRun(runId), 4000)
    return () => clearInterval(timer)
  }, [refreshRun, runId, running])

  const startRun = async () => {
    if (starting || running) return
    setStarting(true)
    setCancelling(false)
    setPaused(false)
    setRunError(null)
    setEvents([])
    setClearedEvents(0)
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
          cacheResources,
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
      // Hand the screen to the pipeline: the inputs and the model slots are
      // settled once the run is created, and the log is where the action is.
      setInputsOpen(false)
      setModelsOpen(false)
      setLogReduced(false)
      setLogOpen(true)
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
    if (!runId || cancelling) return
    setCancelling(true)
    try {
      const result = await cancelRun(runId)
      unsubscribe.current?.()
      unsubscribe.current = null
      setPaused(false)
      if (result.cancelled) {
        setStatus('cancelled')
        setRunError(null)
      } else {
        await refreshRun(runId, true)
      }
    } catch (error) {
      setRunError(messageOf(error))
    } finally {
      setCancelling(false)
    }
  }

  /** Pause at the next step boundary; resume lets the held workers continue. */
  const togglePause = async () => {
    if (!runId || pausing) return
    setPausing(true)
    try {
      const result = paused ? await resumeRun(runId) : await pauseRun(runId)
      setPaused(Boolean(result.paused))
    } catch (error) {
      setRunError(messageOf(error))
    } finally {
      setPausing(false)
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
    setCacheResources(snapshot.options.cacheResources ?? true)
    setAnchors(snapshot.options.anchors)
    setMaxVideoMinutes(snapshot.options.maxVideoMinutes)
    setTemperature(snapshot.options.temperature)
    setStatus(snapshot.status)
    setPaused(false)
    setEvents(snapshot.events)
    setClearedEvents(0)
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
    await refreshHistory()
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

  const sideDock = logDock === 'left' || logDock === 'right'
  const docked = logOpen && !logReduced
  const visibleEvents = React.useMemo(
    () => (clearedEvents > 0 ? events.slice(Math.min(clearedEvents, events.length)) : events),
    [clearedEvents, events],
  )
  const clearEvents = () => setClearedEvents(events.length)
  const runOrigin = events[0]?.at
  const logPanel = (
    <div className={cn('flex min-h-0 min-w-0 shrink-0 flex-col border-border bg-card', DOCK_PANEL_CLASS[logDock])}>
      <EventLog
        events={visibleEvents}
        origin={runOrigin}
        streaming={running && !paused}
        onClear={clearEvents}
        onClose={() => setLogOpen(false)}
        onReduce={() => setLogReduced(true)}
        dock={logDock}
        onDockChange={setLogDock}
        className="rounded-none border-0 shadow-none"
      />
    </div>
  )

  return (
    <div className={cn('flex h-dvh overflow-hidden bg-background', sideDock ? 'flex-row' : 'flex-col')}>
      {docked && logDock === 'left' ? logPanel : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="z-30 flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="" width={28} height={28} className="h-7 w-7" />
          <div className="leading-none">
            <p className="text-[13px] font-bold tracking-tight">Verdict</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{t('app.tagline')}</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => setHistoryOpen((value) => !value)}>
            <History className="h-3.5 w-3.5" /> {t('app.history')}
            {history.length > 0 ? <span className="tabular-nums text-muted-foreground">({history.length})</span> : null}
          </Button>
          <LanguageMenu />
          <AppearanceMenu />
        </div>
      </header>

      {docked && logDock === 'top' ? logPanel : null}

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-2 px-2 pt-2 pb-2">
        <SectionCard
          title={t('inputs.title')}
          icon={<Layers className="h-3.5 w-3.5 text-brand-primary" />}
          open={inputsOpen}
          onOpenChange={setInputsOpen}
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
              {previewing && !preview ? (
                <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Skeleton className="h-5 w-28 rounded-full" />
                    <Skeleton className="h-5 w-24 rounded-full" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-40" />
                  <div className="flex flex-wrap gap-1.5">
                    <Skeleton className="h-5 w-28 rounded-full" />
                    <Skeleton className="h-5 w-24 rounded-full" />
                    <Skeleton className="h-5 w-32 rounded-full" />
                  </div>
                </div>
              ) : preview ? (
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
          open={modelsOpen}
          onOpenChange={setModelsOpen}
          aside={<span className="ml-auto text-[10px] text-muted-foreground">{t('models.aside')}</span>}
          contentClassName="grid grid-cols-1 gap-4 pt-0 md:grid-cols-2"
        >
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('models.evaluators')}</Label>
              <span className="text-[10px] text-muted-foreground">{t('models.allCriteria')}</span>
            </div>
            <ModelSlots
              providers={providers}
              value={evaluatorModels}
              slots={6}
              onChange={setEvaluatorModels}
              idPrefix="eval"
              compact
              loading={providers.length === 0 && !providersError}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2 md:border-l md:border-border md:pl-4">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('models.verifiers')}</Label>
              <span className="text-[10px] text-muted-foreground">{t('models.auditFinal')}</span>
            </div>
            <ModelSlots
              providers={providers}
              value={verifierModels}
              slots={2}
              onChange={setVerifierModels}
              idPrefix="verify"
              compact
              loading={providers.length === 0 && !providersError}
            />

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
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2">
              <Checkbox id="cache-resources" checked={cacheResources} onCheckedChange={(value) => setCacheResources(value === true)} className="mt-0.5" />
              <span>
                <span className="block text-[11px] font-medium">{t('models.cacheResources')}</span>
                <span className="block text-[10px] leading-tight text-muted-foreground">
                  {t('models.cacheResourcesHint')}
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
              events={events}
              loading={agents === undefined && !providersError}
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
        </div>
      </main>

      {docked && logDock === 'bottom' ? logPanel : null}

      <div className="z-20 shrink-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1800px] flex-wrap items-center gap-1.5 px-2 py-1">
          {running ? (
            <>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                disabled={cancelling || pausing}
                onClick={() => void stopRun()}
              >
                {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} {t('run.cancel')}
              </Button>
              <Button
                type="button"
                variant={paused ? 'primary' : 'outline'}
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                disabled={pausing}
                aria-pressed={paused}
                aria-label={paused ? t('run.resume') : t('run.pause')}
                onClick={() => void togglePause()}
              >
                {pausing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : paused ? (
                  <Play className="h-3.5 w-3.5" />
                ) : (
                  <Pause className="h-3.5 w-3.5" />
                )}
                {paused ? t('run.resume') : t('run.pause')}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              disabled={!manifestText.trim() || evaluatorModels.length === 0 || verifierModels.length === 0 || starting}
              onClick={() => void startRun()}
            >
              {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {starting ? t('run.starting') : t('run.evaluate')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label={t('run.refresh')}
            disabled={!runId || refreshing}
            onClick={() => runId && void refreshRun(runId, true)}
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button type="button" variant="outline" size="icon" className="h-7 w-7" aria-label={t('run.export')} disabled={!live.report} onClick={exportReport}>
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant={logOpen ? 'secondary' : 'outline'}
            size="icon"
            className="h-7 w-7"
            aria-label={t('run.log')}
            aria-pressed={logOpen}
            onClick={() => {
              if (logOpen) {
                setLogOpen(false)
              } else {
                setLogReduced(false)
                setLogOpen(true)
              }
            }}
          >
            <Terminal className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant={view === 'results' ? 'secondary' : 'outline'}
            size="icon"
            className="h-7 w-7"
            aria-label={view === 'pipeline' ? t('run.showResults') : t('run.showPipeline')}
            title={view === 'pipeline' ? t('run.showResults') : t('run.showPipeline')}
            disabled={!canToggleView}
            onClick={() => setView((current) => (current === 'pipeline' ? 'results' : 'pipeline'))}
          >
            {view === 'pipeline' ? <BarChart3 className="h-3.5 w-3.5" /> : <Network className="h-3.5 w-3.5" />}
          </Button>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">
            <StatusPill status={status} paused={paused} />
            {runError ? <span className="min-w-0 truncate text-[10px] text-destructive">{runError}</span> : null}
            {!runError && live.report ? (
              <span className="text-[10px] text-muted-foreground">{t('run.reportReady', { date: formatDate(live.report.createdAt) })}</span>
            ) : null}
          </div>
        </div>
      </div>
      </div>

      {docked && logDock === 'right' ? logPanel : null}

      {logOpen && logReduced ? (
        <div className="fixed right-3 bottom-14 z-40">
          <LogPeek events={visibleEvents} origin={runOrigin} onClear={clearEvents} onExpand={() => setLogReduced(false)} onClose={() => setLogOpen(false)} />
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
              {historyLoading && history.length === 0 ? (
                <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
                  {Array.from({ length: 3 }, (_, index) => (
                    <div key={`history-skeleton-${index}`} className="rounded-md border border-border p-2">
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="mt-1.5 h-2.5 w-44" />
                      <Skeleton className="mt-1.5 h-2.5 w-20" />
                    </div>
                  ))}
                </div>
              ) : history.length === 0 ? (
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
