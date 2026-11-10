'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle, cn } from '@verdict/ui'
import { Terminal } from 'lucide-react'
import type { RunEvent } from '@verdict/shared'

function toneOf(event: RunEvent): string {
  if (event.type === 'error') return 'text-destructive'
  if (event.type === 'stage') return 'text-brand-primary font-medium'
  if (event.type === 'report') return 'text-emerald-600'
  if (event.type === 'log') return 'text-muted-foreground'
  return 'text-foreground'
}

export function EventLog({ events }: { events: RunEvent[] }) {
  const end = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [events.length])

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="border-b border-border">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <CardTitle>Run log</CardTitle>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{events.length} events</span>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-auto p-2">
        {events.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Nothing yet. Start a run to stream stages and model verdicts.</p>
        ) : (
          <ul className="flex flex-col gap-0.5 font-mono text-[10px] leading-relaxed">
            {events.map((event, index) => (
              <li key={`${event.at}-${index}`} className={cn('flex gap-2', toneOf(event))}>
                <span className="shrink-0 tabular-nums text-muted-foreground/70">
                  {new Date(event.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className="shrink-0 text-muted-foreground/70">[{event.type}]</span>
                <span className="min-w-0 break-words">
                  {event.projectId ? <span className="text-muted-foreground">{event.projectId}: </span> : null}
                  {event.message}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div ref={end} />
      </CardContent>
    </Card>
  )
}
