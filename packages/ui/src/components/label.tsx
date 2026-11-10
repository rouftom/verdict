'use client'

import * as React from 'react'
import { cn } from '../lib/cn'

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('text-xs font-medium text-foreground/80 peer-disabled:opacity-60', className)}
      {...props}
    />
  ),
)
Label.displayName = 'Label'
