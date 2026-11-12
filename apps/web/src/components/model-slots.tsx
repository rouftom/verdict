'use client'

import * as React from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Shuffle } from 'lucide-react'
import {
  Button,
  SearchSelect,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  type SearchSelectGroup,
} from '@verdict/ui'
import {
  REASONING_EFFORTS,
  reasoningEffortsFor,
  type AgentInfo,
  type ModelRef,
  type ProviderInfo,
  type ReasoningEffort,
} from '@verdict/shared'

export interface ModelSlotsProps {
  providers: ProviderInfo[]
  value: ModelRef[]
  slots: number
  onChange: (value: ModelRef[]) => void
  idPrefix: string
  compact?: boolean
  /** Agent personas, so each slot can explain its role on hover. */
  agents?: AgentInfo[]
  /** Providers are still being fetched: show shimmer rows instead of the empty state. */
  loading?: boolean
}

interface FlatModel {
  key: string
  provider: ModelRef['provider']
  model: string
  label: string
}

function reasoningGroup(efforts: readonly ReasoningEffort[], t: TFunction): SearchSelectGroup[] {
  return [
    {
      id: 'effort',
      label: t('modelSlots.reasoning'),
      options: [
        { value: 'default', label: t('modelSlots.auto'), hint: t('modelSlots.envDefault') },
        ...efforts.map((effort) => ({
          value: effort,
          label: t(`reasoning.${effort}`),
        })),
      ],
    },
  ]
}

/**
 * Slot label with the agent role behind it. Hover and keyboard focus both open
 * the same hint, so the role is reachable without a pointer.
 */
function AgentHint({ agentId, label }: { agentId: string; label: string }) {
  const { t } = useTranslation()
  const name = t(`agents.${agentId}.name`, { defaultValue: label })
  const lens = t(`agents.${agentId}.lens`, { defaultValue: '' })
  const focus = t(`agents.${agentId}.focus`, { defaultValue: '' })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={focus ? `${name}: ${focus}` : name}
          className="inline-flex w-6 shrink-0 cursor-help items-center justify-end rounded text-[10px] tabular-nums text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-[17rem] text-[11px] leading-snug">
        <p className="font-semibold text-foreground">{name}</p>
        {lens ? <p className="text-muted-foreground">{lens}</p> : null}
        {focus ? <p className="mt-1">{focus}</p> : null}
      </TooltipContent>
    </Tooltip>
  )
}

function flatten(providers: ProviderInfo[]): FlatModel[] {
  return providers
    .filter((provider) => provider.configured)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        key: `${provider.id}:${model.id}`,
        provider: provider.id,
        model: model.id,
        label: model.label || model.id,
      })),
    )
}

/** Grouped model options shared by the model slots and the offline processor. */
export function modelGroups(providers: ProviderInfo[]): SearchSelectGroup[] {
  return providers
    .filter((provider) => provider.configured && provider.models.length > 0)
    .map((provider) => ({
      id: provider.id,
      label: provider.label,
      options: provider.models.map((model) => ({
        value: `${provider.id}:${model.id}`,
        label: model.label || model.id,
        keywords: `${provider.id} ${model.id}`,
        ...(model.id !== (model.label || model.id) ? { hint: model.id } : {}),
      })),
    }))
}

function withReasoning(provider: ModelRef['provider'], model: string, effort: string | undefined): ModelRef {
  if (!effort || effort === 'default') return { provider, model }
  const value = effort as ReasoningEffort
  // A level unsupported by the new provider falls back to Auto rather than
  // sending something the API would reject.
  if (!reasoningEffortsFor(provider, model).includes(value)) return { provider, model }
  return { provider, model, reasoningEffort: value }
}

function shuffled<T>(values: readonly T[]): T[] {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap]!, copy[index]!]
  }
  return copy
}

function assignmentKey(models: ModelRef[]): string {
  return models.map((model) => `${model.provider}:${model.model}:${model.reasoningEffort ?? ''}`).join('|')
}

export function ModelSlots({ providers, value, slots, onChange, idPrefix, compact = false, agents, loading = false }: ModelSlotsProps) {
  const { t } = useTranslation()
  const flat = React.useMemo(() => flatten(providers), [providers])
  const groups = React.useMemo(() => modelGroups(providers), [providers])
  const providerCount = groups.length

  const updateModel = (index: number, key: string) => {
    const entry = flat.find((candidate) => candidate.key === key)
    if (!entry) return
    const next = Array.from({ length: slots }, (_, slot) => value[slot] ?? value[0] ?? null)
    const current = next[index]
    next[index] = withReasoning(entry.provider, entry.model, current?.reasoningEffort)
    onChange(
      next.filter((entry): entry is ModelRef => entry !== null).map((entry) => ({ ...entry })),
    )
  }

  const updateReasoning = (index: number, effort: string) => {
    const next = Array.from({ length: slots }, (_, slot) => value[slot] ?? value[0] ?? null)
    const current = next[index]
    if (!current) return
    next[index] = withReasoning(current.provider, current.model, effort)
    onChange(
      next.filter((entry): entry is ModelRef => entry !== null).map((entry) => ({ ...entry })),
    )
  }

  const cycle = () => {
    if (flat.length === 0) return
    const current = Array.from({ length: slots }, (_, index) => value[index]).filter((entry): entry is ModelRef => Boolean(entry))
    const previous = assignmentKey(current)
    let next: ModelRef[] = []
    // Shuffle on every click. Retry when the draw happens to match the current
    // assignment, so the button always changes something when it can.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const pool = shuffled(flat)
      next = Array.from({ length: slots }, (_, index) => {
        // Distinct models while the pool is large enough, rotation otherwise.
        const entry = pool[flat.length >= slots ? index : index % flat.length]!
        return withReasoning(entry.provider, entry.model, value[index]?.reasoningEffort)
      })
      if (assignmentKey(next) !== previous) break
    }
    onChange(next)
  }

  if (loading && flat.length === 0) {
    return (
      <div className={cn('flex flex-col gap-1.5', compact && 'gap-1')} aria-busy="true" aria-live="polite">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-6 w-20" />
        </div>
        <div className="flex flex-col gap-1">
          {Array.from({ length: slots }, (_, index) => (
            <div key={`${idPrefix}-loading-${index}`} className="flex min-w-0 items-center gap-1.5">
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-7 min-w-0 flex-1" />
              <Skeleton className="h-7 w-[84px] shrink-0" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (flat.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-2.5 text-[11px] text-muted-foreground">
        {t('modelSlots.noProvider')}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1.5', compact && 'gap-1')}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {t('modelSlots.modelCount', { count: flat.length })} · {t('modelSlots.providerCount', { count: providerCount })}
        </span>
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={cycle}>
          <Shuffle className="h-3 w-3" /> {t('modelSlots.diversify')}
        </Button>
      </div>
      <TooltipProvider delayDuration={150}>
        <div className="flex flex-col gap-1">
          {Array.from({ length: slots }, (_, index) => {
            const current = value[index]
            const key = current ? `${current.provider}:${current.model}` : ''
            const effort = current?.reasoningEffort ?? 'default'
            const efforts = current ? reasoningEffortsFor(current.provider, current.model) : REASONING_EFFORTS
            const slotLabel = idPrefix === 'eval' ? t('role.evaluator') : t('role.verifier')
            const agentId = agents?.[index]?.id ?? `${idPrefix === 'eval' ? 'e' : 'v'}${index + 1}`
            const slotCode = `${idPrefix === 'eval' ? 'E' : 'V'}${index + 1}`
            return (
              <div key={`${idPrefix}-${index}`} className="flex min-w-0 items-center gap-1.5">
                <AgentHint agentId={agentId} label={slotCode} />
                <SearchSelect
                  value={key}
                  onValueChange={(next) => updateModel(index, next)}
                  groups={groups}
                  ariaLabel={t('modelSlots.modelAria', { slot: slotLabel, index: index + 1 })}
                  placeholder={t('modelSlots.searchModel')}
                  emptyLabel={t('modelSlots.noMatch')}
                  className="min-w-0 flex-1"
                  triggerClassName="w-full min-w-0"
                  size="sm"
                />
                <SearchSelect
                  value={effort}
                  onValueChange={(next) => updateReasoning(index, next)}
                  groups={reasoningGroup(efforts, t)}
                  ariaLabel={t('modelSlots.reasoningAria', { slot: slotLabel, index: index + 1 })}
                  placeholder={t('modelSlots.auto')}
                  searchable={false}
                  className="w-[84px] shrink-0"
                  triggerClassName="w-full"
                  size="sm"
                  align="end"
                />
              </div>
            )
          })}
        </div>
      </TooltipProvider>
    </div>
  )
}
