'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Card, CardContent, CardHeader, CardTitle, Button, cn } from '@verdict/ui'
import { ArrowDownToLine, Maximize2, Minimize2, PanelBottom, PanelLeft, PanelRight, PanelTop, Terminal, Trash2, X } from 'lucide-react'
import type { RunEvent } from '@verdict/shared'

export type LogDock = 'bottom' | 'top' | 'left' | 'right'

const DOCK_ICONS = {
  bottom: PanelBottom,
  top: PanelTop,
  left: PanelLeft,
  right: PanelRight,
} as const

const DOCKS: LogDock[] = ['bottom', 'top', 'left', 'right']

function toneOf(event: RunEvent): string {
  if (event.type === 'error') return 'text-destructive'
  if (event.type === 'stage') return 'text-brand-primary font-medium'
  if (event.type === 'report') return 'text-emerald-600'
  if (event.type === 'log') return 'text-muted-foreground'
  return 'text-foreground'
}

function timeOf(event: RunEvent): string {
  return new Date(event.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function EventLine({ event }: { event: RunEvent }) {
  return (
    <div className={cn('flex gap-2 px-2 py-0.5 font-mono text-[10px] leading-relaxed', toneOf(event))}>
      <span className="shrink-0 tabular-nums text-muted-foreground/70">{timeOf(event)}</span>
      <span className="shrink-0 text-muted-foreground/70">[{event.type}]</span>
      <span className="min-w-0 break-words">
        {event.projectId ? <span className="text-muted-foreground">{event.projectId}: </span> : null}
        {event.message}
      </span>
    </div>
  )
}

export function EventLog({
  events,
  onClose,
  onReduce,
  onClear,
  dock = 'bottom',
  onDockChange,
  className,
}: {
  events: RunEvent[]
  onClose?: () => void
  onReduce?: () => void
  onClear?: () => void
  dock?: LogDock
  onDockChange?: (dock: LogDock) => void
  className?: string
}) {
  const { t } = useTranslation()
  const listRef = React.useRef<VirtuosoHandle | null>(null)
  const scroller = React.useRef<HTMLElement | null>(null)
  const stick = React.useRef(true)
  const [stuck, setStuck] = React.useState(true)
  const listMounted = events.length > 0

  // Real-time autoscroll: follow new events while the reader is at the bottom.
  // Only an upward move from the reader stops the follow, so the programmatic
  // scrolls Virtuoso performs while appending never disable it.
  React.useEffect(() => {
    const element = scroller.current
    if (!element) return
    let previous = element.scrollTop
    const onScroll = () => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight
      const wentUp = element.scrollTop < previous
      previous = element.scrollTop
      if (distance <= 12) {
        stick.current = true
        setStuck(true)
      } else if (wentUp) {
        stick.current = false
        setStuck(false)
      }
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [listMounted])

  React.useEffect(() => {
    if (!stick.current || events.length === 0) return
    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: events.length - 1, align: 'end', behavior: 'auto' })
    })
    return () => cancelAnimationFrame(frame)
  }, [events.length])

  const jumpToLatest = () => {
    stick.current = true
    setStuck(true)
    if (events.length === 0) return
    listRef.current?.scrollToIndex({ index: events.length - 1, align: 'end', behavior: 'auto' })
  }

  return (
    <Card className={cn('relative flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <CardHeader className="border-b border-border">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <CardTitle>{t('log.title')}</CardTitle>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{t('log.events', { count: events.length })}</span>
        {!stuck ? (
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="h-6 w-6"
            aria-label={t('log.jump')}
            title={t('log.jump')}
            onClick={jumpToLatest}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {onClear && events.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6"
            aria-label={t('log.clear')}
            title={t('log.clear')}
            onClick={onClear}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {onDockChange ? (
          <div className="flex items-center gap-0.5">
            {DOCKS.map((position) => {
              const Icon = DOCK_ICONS[position]
              return (
                <Button
                  key={position}
                  type="button"
                  variant={dock === position ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  className="h-6 w-6"
                  aria-label={t(`log.dock${position[0]!.toUpperCase()}${position.slice(1)}`)}
                  title={t(`log.dock${position[0]!.toUpperCase()}${position.slice(1)}`)}
                  aria-pressed={dock === position}
                  onClick={() => onDockChange(position)}
                >
                  <Icon className="h-3.5 w-3.5" />
                </Button>
              )
            })}
          </div>
        ) : null}
        {onReduce ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6"
            aria-label={t('log.reduce')}
            title={t('log.reduce')}
            onClick={onReduce}
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {onClose ? (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('log.close')} onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 p-0">
        {events.length === 0 ? (
          <p className="p-2 text-[11px] text-muted-foreground">{t('log.empty')}</p>
        ) : (
          <Virtuoso
            ref={listRef}
            scrollerRef={(ref) => {
              scroller.current = ref as HTMLElement | null
            }}
            data={events}
            className="h-full"
            followOutput="auto"
            initialTopMostItemIndex={{ index: Math.max(0, events.length - 1), align: 'end' }}
            itemContent={(_index, event) => <EventLine event={event} />}
          />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Reduced run log: a compact fixed card in the bottom-right corner that shows
 * the last events and expands back into the docked panel.
 */
export function LogPeek({
  events,
  onExpand,
  onClose,
  onClear,
}: {
  events: RunEvent[]
  onExpand: () => void
  onClose: () => void
  onClear?: () => void
}) {
  const { t } = useTranslation()
  const latest = events.slice(-3)
  return (
    <Card className="w-[min(92vw,380px)] overflow-hidden shadow-2xl">
      <CardHeader className="min-h-0 gap-1.5 border-b border-border px-2 py-1.5">
        <Terminal className="h-3 w-3 text-muted-foreground" />
        <CardTitle className="text-[11px]">{t('log.title')}</CardTitle>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{t('log.events', { count: events.length })}</span>
        {onClear && events.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-5 w-5"
            aria-label={t('log.clear')}
            title={t('log.clear')}
            onClick={onClear}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-5 w-5"
          aria-label={t('log.expand')}
          title={t('log.expand')}
          onClick={onExpand}
        >
          <Maximize2 className="h-3 w-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-5 w-5"
          aria-label={t('log.close')}
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </CardHeader>
      <CardContent className="max-h-24 overflow-hidden p-0">
        {latest.length === 0 ? (
          <p className="p-2 text-[10px] text-muted-foreground">{t('log.empty')}</p>
        ) : (
          latest.map((event, index) => (
            <div key={`${event.at}-${index}`} className={cn('truncate px-2 py-0.5 font-mono text-[10px] leading-snug', toneOf(event))}>
              {timeOf(event)} <span className="text-muted-foreground/70">[{event.type}]</span> {event.message}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
