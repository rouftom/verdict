'use client'

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { Button, cn } from '@verdict/ui'

export type ArenaToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface ArenaToastItem {
  id: number
  tone: ArenaToastTone
  message: string
}

const TONE_STYLES: Record<ArenaToastTone, string> = {
  info: 'border-brand-primary/30 bg-card/95',
  success: 'border-emerald-500/40 bg-emerald-500/10',
  warning: 'border-amber-500/40 bg-amber-500/10',
  danger: 'border-destructive/40 bg-destructive/10',
}

const TONE_ICON_STYLES: Record<ArenaToastTone, string> = {
  info: 'text-brand-primary',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-destructive',
}

function ToastIcon({ tone }: { tone: ArenaToastTone }) {
  if (tone === 'success') return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
  if (tone === 'warning') return <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
  if (tone === 'danger') return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
  return <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-primary" />
}

/**
 * Event toasts for the arena. They stack top-right over the stage, drop the
 * oldest when the stack is full, and never swallow a click outside the card.
 */
export function ArenaToasts({
  toasts,
  onDismiss,
  label,
  dismissLabel,
}: {
  toasts: ArenaToastItem[]
  onDismiss: (id: number) => void
  label: string
  dismissLabel: string
}) {
  if (toasts.length === 0) return null
  return (
    <div
      className="pointer-events-none absolute bottom-3 right-3 z-[80] flex w-[min(92vw,22rem)] flex-col gap-1.5"
      aria-live="polite"
      aria-label={label}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-lg border px-2.5 py-2 shadow-lg backdrop-blur transition-colors',
            TONE_STYLES[toast.tone],
          )}
        >
          <ToastIcon tone={toast.tone} />
          <p className={cn('min-w-0 flex-1 text-[11px] leading-snug', TONE_ICON_STYLES[toast.tone])}>{toast.message}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-5 w-5 shrink-0 text-muted-foreground"
            aria-label={dismissLabel}
            onClick={() => onDismiss(toast.id)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  )
}
