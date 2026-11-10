import * as React from 'react'
import { cn } from '../lib/cn'

/** Loading placeholder with the shimmer sweep (see `.shimmer` in the web app). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shimmer rounded-lg bg-secondary', className)} aria-hidden="true" {...props} />
}
