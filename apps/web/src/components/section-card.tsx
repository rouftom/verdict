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
  className?: string
  contentClassName?: string
  children: React.ReactNode
}

/** Collapsible console section: title row is the trigger, content collapses under it. */
export function SectionCard({
  title,
  icon,
  aside,
  defaultOpen = true,
  className,
  contentClassName,
  children,
}: SectionCardProps) {
  const [open, setOpen] = React.useState(defaultOpen)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('min-w-0', className)}>
      <Card className="h-full min-w-0">
        <CardHeader className="gap-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                  !open && '-rotate-90',
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
