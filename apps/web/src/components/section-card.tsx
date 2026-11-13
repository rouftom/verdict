'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
} from '@verdict/ui'

export interface SectionCardProps {
  title: string
  icon?: React.ReactNode
  aside?: React.ReactNode
  defaultOpen?: boolean
  /** Controlled mode: pass both `open` and `onOpenChange`. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  /** Override the inner Card, e.g. drop `h-full` in a scrolling column. */
  cardClassName?: string
  contentClassName?: string
  children: React.ReactNode
}

/** Collapsible console section: title row is the trigger, content collapses under it. */
export function SectionCard({
  title,
  icon,
  aside,
  defaultOpen = true,
  open,
  onOpenChange,
  className,
  cardClassName,
  contentClassName,
  children,
}: SectionCardProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const controlled = open !== undefined
  const expanded = controlled ? open : internalOpen
  const change = (next: boolean) => {
    if (!controlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <Collapsible open={expanded} onOpenChange={change} className={cn('min-w-0', className)}>
      <Card className={cn('h-full min-w-0', cardClassName)}>
        <CardHeader className="gap-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                  !expanded && '-rotate-90',
                )}
              />
              {icon}
              <CardTitle>{title}</CardTitle>
            </button>
          </CollapsibleTrigger>
          {aside}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className={contentClassName}>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
