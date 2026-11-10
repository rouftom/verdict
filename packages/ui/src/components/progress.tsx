'use client'

import * as React from 'react'
import { cn } from '../lib/cn'

/**
 * Determinate progress track (0–100). Used where the API reports a real
 * percentage, e.g. a file upload.
 */
export function Progress({
  value,
  className,
  label,
}: {
  value: number
  className?: string
  label?: string
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-brand-primary/15', className)}
    >
      <div
        className="h-full rounded-full bg-brand-primary transition-[width] duration-300 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

/**
 * Indeterminate bar for work whose duration nobody knows · a model call, a
 * scenario tick, a transcription. Mirrors the treatment used by the admin
 * console's long-running jobs instead of a bare spinner.
 */
export function IndeterminateBar({ className, label }: { className?: string; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuetext={label ?? 'Working'}
      aria-label={label}
      className={cn('relative h-1 w-full overflow-hidden rounded-full bg-brand-primary/15', className)}
    >
      <span className="absolute inset-y-0 left-0 w-1/3 animate-[sps-progress_1.5s_ease-in-out_infinite] rounded-full bg-brand-primary" />
    </div>
  )
}
