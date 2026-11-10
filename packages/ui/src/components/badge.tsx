'use client'

import * as React from 'react'
import { cn } from '../lib/cn'

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'brand'

const tones: Record<Tone, string> = {
  neutral: 'border-border bg-muted/60 text-muted-foreground',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  brand: 'border-brand-primary/30 bg-brand-primary/10 text-brand-primary-dark dark:text-brand-primary-light',
}

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
