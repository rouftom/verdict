'use client'

import * as React from 'react'
import { Shuffle } from 'lucide-react'
import { Button, Select, cn } from '@verdict/ui'
import type { ModelRef, ProviderInfo } from '@verdict/shared'

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
  provider: string
  model: string
  label: string
  capabilities: string
}

function flatten(providers: ProviderInfo[]): FlatModel[] {
  return providers
    .filter((provider) => provider.configured)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        key: `${provider.id}:${model.id}`,
        provider: provider.id,
        model: model.id,
        label: `${provider.label} · ${model.id}`,
        capabilities: [
          model.capabilities.vision ? 'vision' : '',
          model.capabilities.video ? 'video' : '',
          model.capabilities.tools ? 'tools' : '',
          model.capabilities.audio ? 'audio' : '',
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    )
}

export function ModelSlots({ providers, value, slots, onChange, idPrefix, compact = false }: ModelSlotsProps) {
  const flat = React.useMemo(() => flatten(providers), [providers])
  const options = flat.map((entry) => ({
    value: entry.key,
    label: entry.label,
    hint: entry.capabilities || undefined,
  }))

  const update = (index: number, key: string) => {
    const entry = flat.find((candidate) => candidate.key === key)
    if (!entry) return
    const next = Array.from({ length: slots }, (_, slot) => value[slot] ?? value[0] ?? null)
    next[index] = { provider: entry.provider as ModelRef['provider'], model: entry.model }
    onChange(
      next.filter((entry): entry is ModelRef => entry !== null).map((entry) => ({ provider: entry.provider, model: entry.model })),
    )
  }

  const cycle = () => {
    if (flat.length === 0) return
    onChange(
      Array.from({ length: slots }, (_, index) => {
        const entry = flat[index % flat.length]!
        return { provider: entry.provider as ModelRef['provider'], model: entry.model }
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

  return (
    <div className={cn('flex flex-col gap-1.5', compact && 'gap-1')}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {flat.length} configured model{flat.length === 1 ? '' : 's'}
        </span>
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={cycle}>
          <Shuffle className="h-3 w-3" /> Diversify
        </Button>
      </div>
      <div className={cn('grid gap-1.5', slots >= 4 ? 'grid-cols-2' : 'grid-cols-1')}>
        {Array.from({ length: slots }, (_, index) => {
          const current = value[index]
          const key = current ? `${current.provider}:${current.model}` : ''
          return (
            <div key={`${idPrefix}-${index}`} className="flex min-w-0 items-center gap-1.5">
              <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                {idPrefix === 'eval' ? 'E' : 'V'}
                {index + 1}
              </span>
              <Select
                value={key}
                onValueChange={(next) => update(index, next)}
                options={options}
                ariaLabel={`${idPrefix} model ${index + 1}`}
                placeholder="choose a model"
                triggerClassName="w-full min-w-0 text-[11px]"
                size="sm"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
