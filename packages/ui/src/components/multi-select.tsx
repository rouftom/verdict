'use client'

import * as React from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../lib/cn'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu'

export interface MultiSelectOption {
  value: string
  label: string
}

/**
 * Several values chosen from a menu. The menu stays open while choosing; at least
 * `minSelected` values stay selected, so the field can never be emptied.
 */
export function MultiSelect({
  values,
  onValuesChange,
  options,
  ariaLabel,
  minSelected = 1,
  maxSelected,
  className,
}: {
  values: string[]
  onValuesChange: (values: string[]) => void
  options: MultiSelectOption[]
  ariaLabel: string
  minSelected?: number
  maxSelected?: number
  className?: string
}) {
  const selected = options.filter((option) => values.includes(option.value))
  const summary = selected.length === 0 ? '—' : selected.length === 1 ? selected[0]!.label : `${selected[0]!.label} +${selected.length - 1}`

  const toggle = (value: string) => {
    const isOn = values.includes(value)
    if (isOn) {
      if (values.length <= minSelected) return
      onValuesChange(values.filter((entry) => entry !== value))
      return
    }
    if (maxSelected !== undefined && values.length >= maxSelected) return
    onValuesChange([...values, value])
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          title={selected.map((option) => option.label).join(', ')}
          className={cn(
            'flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary',
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
          <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{selected.length}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[12rem]">
        {options.map((option) => {
          const on = values.includes(option.value)
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={(event) => {
                event.preventDefault()
                toggle(option.value)
              }}
              className="text-[12px]"
            >
              <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded border', on ? 'border-brand-primary bg-brand-primary text-white' : 'border-border')}>
                {on && <Check className="h-2.5 w-2.5" />}
              </span>
              <span className="truncate">{option.label}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
