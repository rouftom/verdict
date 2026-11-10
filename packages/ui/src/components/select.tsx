'use client'

import * as React from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../lib/cn'

export interface SelectOption {
  value: string
  label: string
  hint?: string
}

export interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  /** Accessible name for the trigger (the visible label already sits outside). */
  ariaLabel?: string
  placeholder?: string
  id?: string
  disabled?: boolean
  /** `sm` for toolbars, `md` for forms. */
  size?: 'sm' | 'md'
  className?: string
  /** Classes for the trigger button itself (the box the user clicks). */
  triggerClassName?: string
  align?: 'start' | 'end'
}

/**
 * Tailwind-only select: a button plus a listbox. The console never renders a
 * native `<select>` · the OS menu ignores the charte and the corner treatment.
 * Keyboard: ↑ ↓ Home End to move, Enter/Space to pick, Escape to close.
 */
export function Select({
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder = 'n/a',
  id,
  disabled = false,
  size = 'sm',
  className,
  triggerClassName,
  align = 'start',
}: SelectProps) {
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(() => Math.max(0, options.findIndex((o) => o.value === value)))
  const container = React.useRef<HTMLDivElement>(null)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const list = React.useRef<HTMLDivElement>(null)

  const selected = options.find((option) => option.value === value)

  React.useEffect(() => {
    if (!open) return
    list.current?.focus()
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const openList = () => {
    setActive(Math.max(0, options.findIndex((option) => option.value === value)))
    setOpen(true)
  }

  const commit = (index: number) => {
    const option = options[index]
    if (!option) return
    onValueChange(option.value)
    setOpen(false)
    trigger.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        openList()
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (index + 1) % options.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (index - 1 + options.length) % options.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(options.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      commit(active)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={container} className={cn('relative', className)}>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent text-left text-foreground outline-none',
          'hover:border-brand-primary/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25',
          'disabled:cursor-not-allowed disabled:opacity-50',
          size === 'sm' ? 'h-8 px-2 text-[11px]' : 'h-9 px-2.5 text-xs',
          triggerClassName,
        )}
      >
        <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          onKeyDown={onKeyDown}
          className={cn(
            'custom-scrollbar absolute top-full z-50 mt-1 max-h-64 min-w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-xl outline-none',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(index)}
                onClick={() => commit(index)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors',
                  index === active
                    ? 'bg-brand-primary/10 text-brand-primary-dark dark:bg-brand-primary-dark/40 dark:text-brand-primary-light'
                    : 'text-foreground hover:bg-secondary',
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {option.label}
                  {option.hint && <span className="ml-1.5 text-[10px] text-muted-foreground">{option.hint}</span>}
                </span>
                {isSelected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
