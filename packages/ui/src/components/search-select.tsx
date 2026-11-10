'use client'

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '../lib/cn'

export interface SearchSelectOption {
  value: string
  label: string
  hint?: string
  /** Extra searchable text, e.g. a provider name inside a flat group. */
  keywords?: string
}

export interface SearchSelectGroup {
  id?: string
  label: string
  options: SearchSelectOption[]
}

export interface SearchSelectProps {
  value: string
  onValueChange: (value: string) => void
  groups: SearchSelectGroup[]
  ariaLabel?: string
  placeholder?: string
  emptyLabel?: string
  /** Hide the search field for short, fixed lists (e.g. reasoning effort). */
  searchable?: boolean
  disabled?: boolean
  id?: string
  size?: 'sm' | 'md'
  align?: 'start' | 'end'
  className?: string
  triggerClassName?: string
}

/**
 * Searchable, grouped select. Ported from the organization console's combobox
 * pattern (search field, grouped items, check mark) but built on the Radix
 * popover already used by the UI package, so the app gains no new dependency.
 * Keyboard: ↑ ↓ Home End, Enter to pick, Escape to close.
 */
export function SearchSelect({
  value,
  onValueChange,
  groups,
  ariaLabel,
  placeholder = 'Select…',
  emptyLabel = 'No match.',
  searchable = true,
  disabled = false,
  id,
  size = 'sm',
  align = 'start',
  className,
  triggerClassName,
}: SearchSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const input = React.useRef<HTMLInputElement>(null)
  const list = React.useRef<HTMLDivElement>(null)

  const selected = React.useMemo(() => {
    for (const group of groups) {
      const option = group.options.find((entry) => entry.value === value)
      if (option) return option
    }
    return undefined
  }, [groups, value])

  const visibleGroups = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return groups
    return groups
      .map((group) => ({
        ...group,
        options: group.options.filter((option) =>
          `${group.label} ${option.label} ${option.hint ?? ''} ${option.keywords ?? ''}`
            .toLowerCase()
            .includes(needle),
        ),
      }))
      .filter((group) => group.options.length > 0)
  }, [groups, query])

  const visible = React.useMemo(() => visibleGroups.flatMap((group) => group.options), [visibleGroups])

  React.useEffect(() => {
    if (!open) return
    const index = visible.findIndex((option) => option.value === value)
    setActive(index >= 0 ? index : 0)
  }, [open, value, visible])

  React.useEffect(() => {
    if (!open || !searchable) return
    setQuery('')
  }, [open, searchable])

  React.useEffect(() => {
    if (!open) return
    const node = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const commit = (next: string) => {
    onValueChange(next)
    setOpen(false)
    trigger.current?.focus()
  }

  const openList = () => {
    if (disabled) return
    setOpen(true)
  }

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (open) return
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      openList()
    }
  }

  const onListKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (visible.length === 0 ? 0 : (index + 1) % visible.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (visible.length === 0 ? 0 : (index - 1 + visible.length) % visible.length))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(Math.max(0, visible.length - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = visible[active]
      if (option) commit(option.value)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={trigger}
          id={id}
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            'flex w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent text-left text-foreground outline-none',
            'hover:border-brand-primary/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25',
            'disabled:cursor-not-allowed disabled:opacity-50',
            size === 'sm' ? 'h-8 px-2 text-[11px]' : 'h-9 px-2.5 text-xs',
            triggerClassName,
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={4}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (searchable) input.current?.focus()
            else list.current?.focus()
          }}
          onKeyDown={onListKeyDown}
          className="z-[1000] w-[var(--radix-popover-trigger-width)] min-w-[200px] overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl outline-none"
        >
          {searchable ? (
            <div className="flex items-center gap-1.5 border-b border-border px-1.5 pb-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                ref={input}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActive(0)
                }}
                placeholder="Search…"
                aria-label={ariaLabel ? `Search ${ariaLabel}` : 'Search'}
                className="h-7 w-full min-w-0 border-0 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/70"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  onClick={() => {
                    setQuery('')
                    setActive(0)
                    input.current?.focus()
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          ) : null}

          <div ref={list} role="listbox" tabIndex={-1} aria-label={ariaLabel} className="custom-scrollbar max-h-64 overflow-y-auto outline-none">
            {visible.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">{emptyLabel}</p>
            ) : (
              visibleGroups.map((group, groupIndex) => (
                <div key={`${group.id ?? group.label}-${groupIndex}`} className="py-0.5">
                  <p className="px-2 py-1 text-[9px] font-medium uppercase tracking-widest text-muted-foreground">{group.label}</p>
                  {group.options.map((option) => {
                    const index = visible.indexOf(option)
                    const isSelected = option.value === value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-index={index}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => commit(option.value)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors',
                          index === active
                            ? 'bg-brand-primary/10 text-brand-primary-dark dark:bg-brand-primary-dark/40 dark:text-brand-primary-light'
                            : 'text-foreground hover:bg-secondary',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {option.label}
                          {option.hint ? <span className="ml-1.5 text-[10px] text-muted-foreground">{option.hint}</span> : null}
                        </span>
                        {isSelected ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
