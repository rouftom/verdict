'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { Button, SearchSelect } from '@verdict/ui'
import type { ModelRef, OfflineMapping, ProviderInfo } from '@verdict/shared'
import {
  matchOfflineBundle,
  uploadOfflineBundle,
  type OfflineCandidate,
  type OfflineInputsPayload,
} from '@/lib/api'
import { FileUploader } from '@/components/file-uploader'
import { modelGroups } from '@/components/model-slots'
import { applyAgentMapping, formatBytes, sourceLabel, usedByOthers, withMatch } from '@/lib/offline'

export interface OfflineBundleInfo {
  id: string
  label: string
  files: number
  repos: number
  videos: number
  bytes: number
}

export interface OfflinePanelValue {
  bundle: OfflineBundleInfo | null
  mapping: OfflineMapping
}

export interface OfflineBundlePanelProps {
  /** The manifest currently in the sheet; the matcher reads it for project ids. */
  manifestText: string
  providers: ProviderInfo[]
  /** Used until the operator picks a dedicated processor model. */
  fallbackModel?: ModelRef
  /** Candidates on stage: only these rows are offered. */
  projectIds: string[]
  projectNames: Map<string, string>
  /** The arena is voting: the bundle and its mapping must not change. */
  disabled?: boolean
  /** A bundle can carry the manifest and rules; fill them when it does. */
  onInputs: (inputs: OfflineInputsPayload) => void
  onChange: (value: OfflinePanelValue) => void
}

function modelKey(ref: ModelRef | undefined): string {
  return ref ? `${ref.provider}:${ref.model}` : ''
}

function modelFromKey(key: string): ModelRef | undefined {
  const separator = key.indexOf(':')
  if (separator <= 0) return undefined
  return { provider: key.slice(0, separator) as ModelRef['provider'], model: key.slice(separator + 1) }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Attach the offline bundle inside a live workspace (the arena). Uploading one
 * fills the sheet from its detected manifest and rules, seeds the automatic
 * matches, then hands the leftovers to the matching agent. Only the projects
 * on stage get a mapping row, so a large manifest stays readable.
 */
export function OfflineBundlePanel({
  manifestText,
  providers,
  fallbackModel,
  projectIds,
  projectNames,
  disabled = false,
  onInputs,
  onChange,
}: OfflineBundlePanelProps) {
  const { t } = useTranslation()
  const [bundle, setBundle] = React.useState<OfflineBundleInfo | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [warnings, setWarnings] = React.useState<string[]>([])
  const [candidates, setCandidates] = React.useState<{
    repositories: OfflineCandidate[]
    videos: OfflineCandidate[]
  } | null>(null)
  const [mapping, setMapping] = React.useState<OfflineMapping>({})
  /** Halves the user picked by hand; the agent never overrides them. */
  const [manual, setManual] = React.useState<OfflineMapping>({})
  const [processor, setProcessor] = React.useState<ModelRef | undefined>()
  const [matching, setMatching] = React.useState(false)
  const [matchError, setMatchError] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState('')
  const [agentRan, setAgentRan] = React.useState(false)
  const [pendingAutoMatch, setPendingAutoMatch] = React.useState<{ bundleId: string; manifest: string } | null>(null)
  const autoMatchStarted = React.useRef<string | null>(null)

  const activeModel = processor ?? fallbackModel

  React.useEffect(() => {
    if (!processor && fallbackModel) setProcessor(fallbackModel)
  }, [fallbackModel, processor])

  // Report the attached bundle and its mapping whenever either moves. The
  // parent stores the value; it never feeds it back as a prop, so this cannot
  // loop even though the callback is re-created on each render.
  const onChangeRef = React.useRef(onChange)
  onChangeRef.current = onChange
  React.useEffect(() => {
    onChangeRef.current({ bundle, mapping })
  }, [bundle, mapping])

  const runMatchingAgent = React.useCallback(
    async (options: { bundleId: string; manifest: string; model: ModelRef; manual: OfflineMapping }) => {
      setMatching(true)
      setMatchError(null)
      try {
        const result = await matchOfflineBundle(options.bundleId, options.manifest, options.model)
        setMapping(applyAgentMapping(result.mapping, options.manual))
        setNotes(result.notes)
        setAgentRan(true)
        setWarnings((current) => [...current, ...result.warnings.filter((warning) => !current.includes(warning))])
      } catch (cause) {
        setMatchError(messageOf(cause))
      } finally {
        setMatching(false)
      }
    },
    [],
  )
  const matchRef = React.useRef(runMatchingAgent)
  matchRef.current = runMatchingAgent

  // One agent pass per upload, once the processor model is known.
  React.useEffect(() => {
    if (!pendingAutoMatch || !activeModel) return
    if (autoMatchStarted.current === pendingAutoMatch.bundleId) return
    autoMatchStarted.current = pendingAutoMatch.bundleId
    const request = pendingAutoMatch
    setPendingAutoMatch(null)
    void matchRef.current({ ...request, model: activeModel, manual: {} })
  }, [pendingAutoMatch, activeModel])

  const attach = async (file: File, hooks: { onProgress: (percent: number) => void }): Promise<void> => {
    setError(null)
    setWarnings([])
    const result = await uploadOfflineBundle(file, hooks.onProgress)
    if (result.inputs) onInputs(result.inputs)
    setBundle({
      id: result.id,
      label: result.label,
      files: result.files,
      repos: result.repos,
      videos: result.videos,
      bytes: result.bytes,
    })
    setCandidates(result.candidates)
    setMapping(result.mapping)
    setManual({})
    setMatchError(null)
    setNotes('')
    setAgentRan(false)
    setWarnings(result.warnings)
    const detectedManifest = result.inputs?.manifestText ?? manifestText
    const hasManifest = Boolean(result.inputs?.manifestText) || Boolean(manifestText.trim())
    if (!hasManifest) setError(t('offline.noManifest'))
    setPendingAutoMatch(hasManifest ? { bundleId: result.id, manifest: detectedManifest } : null)
  }

  const clear = () => {
    setBundle(null)
    setError(null)
    setWarnings([])
    setCandidates(null)
    setMapping({})
    setManual({})
    setMatchError(null)
    setNotes('')
    setAgentRan(false)
    setPendingAutoMatch(null)
  }

  /** A hand-picked source, exclusive: one bundle path feeds one project. */
  const setMatch = (projectId: string, kind: 'repository' | 'video', path: string) => {
    setManual((current) => withMatch(current, projectId, kind, path))
    setMapping((current) => withMatch(current, projectId, kind, path))
  }

  const selectedProjects = projectIds.map((id) => ({ id, name: projectNames.get(id) ?? id }))
  const linked = selectedProjects.filter(({ id }) => {
    const match = mapping[id]
    return Boolean(match?.repository && match?.video)
  })
  const incomplete = selectedProjects.filter(({ id }) => {
    const match = mapping[id]
    return !match?.repository || !match?.video
  })
  // A missing video is normal; a candidate with no source at all is the real gap.
  const sourceLess = selectedProjects.filter(({ id }) => {
    const match = mapping[id]
    return !match?.repository && !match?.video
  })

  return (
    <div className="flex flex-col gap-2">
      <FileUploader
        id="arena-offline"
        label={t('offline.title')}
        hint={t('offline.hint')}
        accept=".zip,application/zip,application/x-zip-compressed,application/octet-stream"
        disabled={disabled || matching}
        filename={bundle?.label}
        detail={
          bundle
            ? [
                t('offline.summaryFiles', { count: bundle.files }),
                t('offline.summaryRepos', { count: bundle.repos }),
                t('offline.summaryVideos', { count: bundle.videos }),
                formatBytes(bundle.bytes),
              ].join(' · ')
            : undefined
        }
        aside={
          <>
            <span className="text-[10px] text-muted-foreground">{t('offline.processorLabel')}</span>
            {matching ? <Loader2 className="h-3 w-3 animate-spin text-brand-primary" aria-hidden /> : null}
            <SearchSelect
              size="sm"
              className="w-[180px]"
              groups={modelGroups(providers)}
              value={modelKey(activeModel)}
              onValueChange={(key) => setProcessor(modelFromKey(key))}
              ariaLabel={t('offline.processorAria')}
              placeholder={t('offline.processorPlaceholder')}
              emptyLabel={t('modelSlots.noMatch')}
              disabled={disabled || matching}
            />
          </>
        }
        error={error && !manifestText.trim() ? error : null}
        onFile={attach}
        onClear={clear}
      />

      {warnings.length > 0 ? (
        <ul className="list-inside list-disc text-[10px] text-amber-600">
          {warnings.slice(0, 5).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {bundle && candidates ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-medium">
              {t('arena.offlineLinked', { linked: linked.length, total: selectedProjects.length })}
            </p>
            <span className="text-[10px] text-muted-foreground">{t('arena.offlineHint')}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto h-6 px-2 text-[10px]"
              onClick={() => {
                if (!bundle || !activeModel || !manifestText.trim() || matching) return
                void runMatchingAgent({
                  bundleId: bundle.id,
                  manifest: manifestText,
                  model: activeModel,
                  manual,
                })
              }}
              disabled={matching || disabled || !manifestText.trim() || !activeModel}
            >
              {matching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {matching ? t('offline.matching') : t('offline.matchAgent')}
            </Button>
          </div>

          {matching ? (
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> {t('offline.processing')}
            </p>
          ) : null}
          {matchError ? <p className="text-[10px] text-destructive">{matchError}</p> : null}
          {notes ? (
            <p className="text-[10px] text-muted-foreground">
              <span className="font-medium">{t('offline.agentNotes')}</span> {notes}
            </p>
          ) : null}

          {selectedProjects.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">{t('arena.offlineNoCandidates')}</p>
          ) : incomplete.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[10px] text-emerald-600">
              <Check className="h-3 w-3" /> {t('offline.mappingDone')}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5">
              {incomplete.map((project) => {
                const match = mapping[project.id] ?? {}
                const usedRepositories = usedByOthers(mapping, project.id, 'repository')
                const usedVideos = usedByOthers(mapping, project.id, 'video')
                return (
                  <div
                    key={project.id}
                    className="flex flex-col gap-1 rounded border border-border/60 bg-background/40 p-1.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[11px]" title={project.name}>
                        {project.name}
                      </span>
                      {match.repository && match.video ? (
                        <Check className="h-3 w-3 shrink-0 text-emerald-600" aria-label={t('offline.mappingComplete')} />
                      ) : agentRan && !match.repository && !match.video ? (
                        <span className="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground">
                          {t('offline.noSourceInBundle')}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        aria-label={t('offline.repositoryAria', { name: project.name })}
                        className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1 text-[10px]"
                        value={match.repository ?? ''}
                        disabled={disabled || matching}
                        onChange={(event) => setMatch(project.id, 'repository', event.target.value)}
                      >
                        <option value="">{t('offline.noRepository')}</option>
                        {candidates.repositories
                          .filter(
                            (candidate) =>
                              candidate.path === match.repository || !usedRepositories.has(candidate.path),
                          )
                          .map((candidate) => (
                            <option key={candidate.path} value={candidate.path}>
                              {candidate.label}
                            </option>
                          ))}
                      </select>
                      <select
                        aria-label={t('offline.videoAria', { name: project.name })}
                        className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1 text-[10px]"
                        value={match.video ?? ''}
                        disabled={disabled || matching}
                        onChange={(event) => setMatch(project.id, 'video', event.target.value)}
                      >
                        <option value="">{t('offline.noVideo')}</option>
                        {candidates.videos
                          .filter(
                            (candidate) => candidate.path === match.video || !usedVideos.has(candidate.path),
                          )
                          .map((candidate) => (
                            <option key={candidate.path} value={candidate.path}>
                              {candidate.label}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {sourceLess.length > 0 && !agentRan ? (
            <p className="text-[10px] text-muted-foreground">
              {t('arena.offlineSourceLess', { names: sourceLess.map((project) => project.name).join(', ') })}
            </p>
          ) : null}
          {linked.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {linked.slice(0, 4).map(({ id, name }) => {
                const match = mapping[id]!
                return (
                  <li
                    key={id}
                    className="flex min-w-0 flex-wrap items-center gap-1.5 rounded border border-border/60 bg-background/40 px-1.5 py-1 text-[10px]"
                    title={`${match.repository}\n${match.video}`}
                  >
                    <Check className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
                    <span className="min-w-0 truncate font-medium">{name}</span>
                    <span className="min-w-0 truncate text-muted-foreground">{sourceLabel(match.repository)}</span>
                    <span className="text-muted-foreground/60">+</span>
                    <span className="min-w-0 truncate text-muted-foreground">{sourceLabel(match.video)}</span>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
