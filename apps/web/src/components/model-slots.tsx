'use client'

import * as React from 'react'
import { Shuffle } from 'lucide-react'
import { Button, SearchSelect, cn, type SearchSelectGroup } from '@verdict/ui'
import {
  REASONING_EFFORTS,
  REASONING_EFFORT_LABELS,
  reasoningEffortsFor,
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
}

interface FlatModel {
  key: string
  provider: ModelRef['provider']
  model: string
  label: string
}

function reasoningGroup(efforts: readonly ReasoningEffort[]): SearchSelectGroup[] {
  return [
    {
      id: 'effort',
      label: 'Reasoning effort',
      options: [
        { value: 'default', label: 'Auto', hint: 'env default' },
        ...efforts.map((effort) => ({
          value: effort,
          label: REASONING_EFFORT_LABELS[effort],
        })),
      ],
    },
  ]
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

function modelGroups(providers: ProviderInfo[]): SearchSelectGroup[] {
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

export function ModelSlots({ providers, value, slots, onChange, idPrefix, compact = false }: ModelSlotsProps) {
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
    onChange(
      Array.from({ length: slots }, (_, index) => {
        const entry = flat[index % flat.length]!
        return { provider: entry.provider, model: entry.model }
      }),
    )
  }

  if (flat.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-2.5 text-[11px] text-muted-foreground">
        No provider is configured. Add a key to <code className="font-mono">.env</code> (for example{' '}
        <code className="font-mono">MODEL_API_KEY</code> or <code className="font-mono">OPENAI_API_KEY</code>), then reload.
      </div>
    )
  }

  const hidden = providers.filter((provider) => !provider.configured).length

  return (
    <div className={cn('flex flex-col gap-1.5', compact && 'gap-1')}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {flat.length} model{flat.length === 1 ? '' : 's'} · {providerCount} provider{providerCount === 1 ? '' : 's'}
        </span>
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={cycle}>
          <Shuffle className="h-3 w-3" /> Diversify
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        {Array.from({ length: slots }, (_, index) => {
          const current = value[index]
          const key = current ? `${current.provider}:${current.model}` : ''
          const effort = current?.reasoningEffort ?? 'default'
          const efforts = current ? reasoningEffortsFor(current.provider, current.model) : REASONING_EFFORTS
          return (
            <div key={`${idPrefix}-${index}`} className="flex min-w-0 items-center gap-1.5">
              <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                {idPrefix === 'eval' ? 'E' : 'V'}
                {index + 1}
              </span>
              <SearchSelect
                value={key}
                onValueChange={(next) => updateModel(index, next)}
                groups={groups}
                ariaLabel={`${idPrefix} model ${index + 1}`}
                placeholder="Search a model"
                emptyLabel="No configured model matches."
                className="min-w-0 flex-1"
                triggerClassName="w-full min-w-0"
                size="sm"
              />
              <SearchSelect
                value={effort}
                onValueChange={(next) => updateReasoning(index, next)}
                groups={reasoningGroup(efforts)}
                ariaLabel={`${idPrefix} reasoning effort ${index + 1}`}
                placeholder="Auto"
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
      {hidden > 0 ? (
        <p className="text-[10px] text-muted-foreground">
          {hidden} provider{hidden === 1 ? '' : 's'} without a key {hidden === 1 ? 'is' : 'are'} hidden.
        </p>
      ) : null}
    </div>
  )
}
