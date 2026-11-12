'use client'

import * as React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Card, CardContent, CardHeader, CardTitle, Button, cn } from '@verdict/ui'
import { ArrowDownToLine, Check, Copy, Maximize2, Minimize2, PanelBottom, PanelLeft, PanelRight, PanelTop, Terminal, Trash2, X } from 'lucide-react'
import type { RunEvent } from '@verdict/shared'
import { formatElapsed } from '@/lib/run-timeline'
import { SpiralStream } from './stream-indicator'

export type LogDock = 'bottom' | 'top' | 'left' | 'right'

/** Virtuoso scroller with the console's thin scrollbar. */
const VirtuosoScroller = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('custom-scrollbar', className)} {...props} />,
)
VirtuosoScroller.displayName = 'VirtuosoScroller'

const DOCK_ICONS = {
  bottom: PanelBottom,
  top: PanelTop,
  left: PanelLeft,
  right: PanelRight,
} as const

const DOCKS: LogDock[] = ['bottom', 'top', 'left', 'right']

interface EventTone {
  text: string
  chip: string
  row: string
}

/** One colour per event kind, so the stream reads like a real console. */
const TONES: Record<RunEvent['type'], EventTone> = {
  stage: {
    text: 'text-sky-700 dark:text-sky-300',
    chip: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    row: 'bg-sky-500/5',
  },
  log: { text: 'text-muted-foreground', chip: 'bg-muted text-muted-foreground', row: '' },
  project: {
    text: 'text-indigo-600 dark:text-indigo-300',
    chip: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
    row: '',
  },
  evidence: {
    text: 'text-cyan-700 dark:text-cyan-300',
    chip: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
    row: '',
  },
  screening: {
    text: 'text-fuchsia-700 dark:text-fuchsia-300',
    chip: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
    row: '',
  },
  evaluation: {
    text: 'text-violet-700 dark:text-violet-300',
    chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    row: '',
  },
  revision: {
    text: 'text-amber-700 dark:text-amber-300',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    row: '',
  },
  consensus: {
    text: 'text-teal-700 dark:text-teal-300',
    chip: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
    row: '',
  },
  verification: {
    text: 'text-emerald-700 dark:text-emerald-300',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    row: '',
  },
  report: {
    text: 'text-emerald-600 dark:text-emerald-300 font-semibold',
    chip: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    row: 'bg-emerald-500/5',
  },
  error: {
    text: 'text-destructive',
    chip: 'bg-destructive/15 text-destructive',
    row: 'bg-destructive/5',
  },
}

const AGENT_TONES: Record<string, string> = {
  e1: 'text-sky-600 dark:text-sky-400',
  e2: 'text-fuchsia-600 dark:text-fuchsia-400',
  e3: 'text-amber-600 dark:text-amber-400',
  e4: 'text-rose-600 dark:text-rose-400',
  e5: 'text-emerald-600 dark:text-emerald-400',
  e6: 'text-indigo-600 dark:text-indigo-400',
  v1: 'text-violet-600 dark:text-violet-400',
  v2: 'text-teal-600 dark:text-teal-400',
}

/** The agent that produced an evaluation, revision or verification event. */
function agentOf(event: RunEvent): { id: string; name?: string } | undefined {
  if (!event.data || typeof event.data !== 'object') return undefined
  const data = event.data as Record<string, unknown>
  const id = typeof data.agentId === 'string' ? data.agentId : typeof data.verifierId === 'string' ? data.verifierId : undefined
  if (!id) return undefined
  const name = typeof data.agentName === 'string' ? data.agentName : typeof data.verifierName === 'string' ? data.verifierName : undefined
  return { id, ...(name ? { name } : {}) }
}

function toneOf(event: RunEvent): EventTone {
  return TONES[event.type] ?? TONES.log
}

function timeOf(event: RunEvent): string {
  return new Date(event.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function elapsedOf(event: RunEvent, origin?: string): string | undefined {
  if (!origin) return undefined
  const start = Date.parse(origin)
  const at = Date.parse(event.at)
  if (Number.isNaN(start) || Number.isNaN(at) || at < start) return undefined
  return `+${formatElapsed(at - start)}`
}

/** One event as plain text, exactly as the console reads, for the copy button. */
function plainLine(event: RunEvent, origin?: string): string {
  const agent = agentOf(event)
  const elapsed = elapsedOf(event, origin)
  const parts = [timeOf(event)]
  if (elapsed) parts.push(elapsed)
  parts.push(event.type.toUpperCase())
  if (agent) parts.push(`[${agent.name ?? agent.id}]`)
  const message = event.projectId ? `${event.projectId}: ${event.message ?? ''}` : (event.message ?? '')
  parts.push(message)
  return parts.join(' ')
}

/**
 * Copy the whole log as text. Falls back to a hidden textarea when the
 * clipboard API is unavailable or the page is not a secure context.
 */
function useCopyLog(events: RunEvent[], origin?: string) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = React.useCallback(async () => {
    const text = events.map((event) => plainLine(event, origin)).join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }, [events, origin])

  return { copied, copy }
}

/**
 * The stream indicator sits between the two last lines: a hairline bar hangs
 * from the bottom of the previous line, a light runs down it, and the wind toy
 * waits at its foot, in front of the last line. Same motion language as the
 * assistant chat, so a live run reads as one continuous stream.
 */
function StreamBridge() {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  return (
    <div
      className="flex flex-col items-start gap-0 border-l-2 border-transparent px-2 py-0 font-mono"
      aria-live="polite"
      aria-label={t('log.streaming')}
      data-testid="stream-indicator"
    >
      <span className="relative -mb-px block h-1.5 w-px overflow-hidden rounded-full bg-brand-primary/20">
        {reduce ? null : (
          <motion.span
            className="absolute inset-x-0 h-1/2 w-px rounded-full bg-gradient-to-b from-transparent via-brand-primary to-transparent"
            initial={{ top: '-50%' }}
            animate={{ top: ['-50%', '100%'] }}
            transition={{ duration: 1.6, ease: 'easeInOut', repeat: Infinity }}
            style={{ boxShadow: '0 0 8px 1px var(--primary)' }}
          />
        )}
      </span>
      <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <motion.span
          className="absolute inset-[-3px] rounded-full bg-brand-primary/30 blur-[5px]"
          animate={reduce ? undefined : { opacity: [0.25, 0.9, 0.25], scale: [0.85, 1.15, 0.85] }}
          transition={{ duration: 1.8, ease: 'easeInOut', repeat: Infinity }}
        />
        <SpiralStream className="relative h-3 w-3 text-brand-primary" />
      </span>
    </div>
  )
}

function EventLine({ event, origin }: { event: RunEvent; origin?: string }) {
  const { t } = useTranslation()
  const tone = toneOf(event)
  const agent = agentOf(event)
  const agentLabel = agent ? t(`agents.${agent.id}.name`, { defaultValue: agent.name ?? agent.id }) : undefined
  const elapsed = elapsedOf(event, origin)
  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-l-2 border-transparent px-2 py-0.5 font-mono text-[11px] leading-relaxed', tone.text, tone.row)}>
      <span className="shrink-0 tabular-nums text-muted-foreground/70">{timeOf(event)}</span>
      {elapsed ? <span className="shrink-0 tabular-nums text-muted-foreground/50">{elapsed}</span> : null}
      <span className={cn('shrink-0 rounded px-1 text-[10px] font-semibold uppercase tracking-wide', tone.chip)}>{event.type}</span>
      {agent && agentLabel ? (
        <span className={cn('shrink-0 font-semibold', AGENT_TONES[agent.id] ?? 'text-foreground')}>[{agentLabel}]</span>
      ) : null}
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
  origin,
  streaming = false,
}: {
  events: RunEvent[]
  onClose?: () => void
  onReduce?: () => void
  onClear?: () => void
  dock?: LogDock
  onDockChange?: (dock: LogDock) => void
  className?: string
  /** Timestamp of the run's first event, used for the elapsed column. */
  origin?: string
  /** Shows the stream indicator between the two last lines while a run streams. */
  streaming?: boolean
}) {
  const { t } = useTranslation()
  const listRef = React.useRef<VirtuosoHandle | null>(null)
  const scroller = React.useRef<HTMLElement | null>(null)
  const stick = React.useRef(true)
  const [stuck, setStuck] = React.useState(true)
  const { copied, copy } = useCopyLog(events, origin)
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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6"
          aria-label={t('log.copy')}
          title={copied ? t('log.copied') : t('log.copy')}
          onClick={copy}
          disabled={events.length === 0}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
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
          <p className="p-2 text-[11px] text-muted-foreground">
            {t('log.empty')}
            {streaming ? (
              <span className="ml-1.5 inline-flex items-center gap-1 align-middle" aria-live="polite" data-testid="stream-indicator">
                <SpiralStream className="h-3 w-3 text-brand-primary" />
              </span>
            ) : null}
          </p>
        ) : (
          <Virtuoso
            ref={listRef}
            scrollerRef={(ref) => {
              scroller.current = ref as HTMLElement | null
            }}
            data={events}
            className="h-full"
            components={{ Scroller: VirtuosoScroller }}
            followOutput="auto"
            initialTopMostItemIndex={{ index: Math.max(0, events.length - 1), align: 'end' }}
            itemContent={(index, event) => (
              <div>
                {streaming && index === events.length - 1 ? <StreamBridge /> : null}
                <EventLine event={event} origin={origin} />
              </div>
            )}
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
  origin,
}: {
  events: RunEvent[]
  onExpand: () => void
  onClose: () => void
  onClear?: () => void
  origin?: string
}) {
  const { t } = useTranslation()
  const latest = events.slice(-3)
  const { copied, copy } = useCopyLog(events, origin)
  return (
    <Card className="w-[min(92vw,380px)] overflow-hidden shadow-2xl">
      <CardHeader className="min-h-0 gap-1.5 border-b border-border px-2 py-1.5">
        <Terminal className="h-3 w-3 text-muted-foreground" />
        <CardTitle className="text-[11px]">{t('log.title')}</CardTitle>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{t('log.events', { count: events.length })}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-5 w-5"
          aria-label={t('log.copy')}
          title={copied ? t('log.copied') : t('log.copy')}
          onClick={copy}
          disabled={events.length === 0}
        >
          {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
        </Button>
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
          latest.map((event, index) => {
            const tone = toneOf(event)
            const elapsed = elapsedOf(event, origin)
            return (
              <div key={`${event.at}-${index}`} className={cn('truncate px-2 py-0.5 font-mono text-[10px] leading-snug', tone.text, tone.row)}>
                {timeOf(event)}
                {elapsed ? <span className="text-muted-foreground/50"> {elapsed}</span> : null}{' '}
                <span className={cn('rounded px-1 text-[9px] font-semibold uppercase', tone.chip)}>{event.type}</span> {event.message}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
