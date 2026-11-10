'use client'

import React, { useRef, useState, useEffect } from 'react'
import { Tabs as TabsRoot, TabsList as PrimitiveTabsList, TabsTrigger } from './tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'
import { Button } from './button'
import { cn } from '../lib/cn'
import { ChevronLeft, ChevronRight, LucideIcon } from 'lucide-react'
import { motion } from 'framer-motion'
import { StarBorder } from './StarBorder'

export interface TabItem {
  id: string
  label: string
  /** Hover/focus hint when the label is collapsed; defaults to the label. */
  tooltip?: string
  icon: LucideIcon
  colorCls?: string
  indicatorBg?: string
  borderColor?: string
  disabled?: boolean
}

export interface AnimatedTabsListProps {
  items: TabItem[]
  value?: string
  onValueChange?: (value: string) => void
  isSaving?: boolean
  showLabels?: boolean
  showScrollButtons?: boolean
  fullWidth?: boolean
  maxWidth?: string
  className?: string
  containerBreakpoint?: string
  activeBorderColor?: string
  showTooltips?: boolean
  surfaceClassName?: string
  /** Compact strip: smaller type, tighter padding, small radius. */
  dense?: boolean
}

export function AnimatedTabsList({
  items,
  value,
  onValueChange,
  isSaving = false,
  showLabels = true,
  showScrollButtons = false,
  fullWidth = false,
  maxWidth = "max-w-md",
  className,
  containerBreakpoint = "@xl",
  activeBorderColor,
  showTooltips,
  surfaceClassName,
  dense = false,
}: AnimatedTabsListProps) {
  const radius = dense ? "rounded-xl" : "rounded-3xl"
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [showLeftArrow, setShowLeftArrow] = useState(false)
  const [showRightArrow, setShowRightArrow] = useState(false)
  const [labelsCollapsed, setLabelsCollapsed] = useState(true)

  const activeTab = items.find(item => item.id === value)
  const borderColor = activeBorderColor || activeTab?.borderColor || "indigo"

  const checkScroll = () => {
    if (tabsListRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabsListRef.current
      setShowLeftArrow(scrollLeft > 0)
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 5)
    }
  }

  useEffect(() => {
    const tabsList = tabsListRef.current
    if (!tabsList) return

    const resizeObserver = new ResizeObserver(() => {
      checkScroll()
      const labelSpan = tabsList.querySelector<HTMLElement>('[data-label]')
      setLabelsCollapsed(!labelSpan || labelSpan.offsetWidth === 0)
    })

    resizeObserver.observe(tabsList)
    checkScroll()

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    checkScroll()
  }, [items])

  const prevValueRef = useRef(value)

  useEffect(() => {
    const container = tabsListRef.current
    if (!container) return

    const prevIndex = items.findIndex(i => i.id === prevValueRef.current)
    const nextIndex = items.findIndex(i => i.id === value)
    prevValueRef.current = value

    const triggers = container.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]')
    const clickedEl = triggers[nextIndex]
    if (!clickedEl) return

    const direction = nextIndex > prevIndex ? 'right' : 'left'
    const step = clickedEl.offsetWidth

    container.scrollBy({
      left: direction === 'right' ? step : -step,
      behavior: 'smooth'
    })

    setTimeout(checkScroll, 350)
  }, [value, items])

  const scroll = (direction: 'left' | 'right') => {
    const container = tabsListRef.current
    if (!container) return

    const triggers = container.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]')
    let step = container.clientWidth * 0.5

    for (const trigger of triggers) {
      const rect = trigger.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const isPartiallyHidden = direction === 'right'
        ? rect.right > containerRect.right
        : rect.left < containerRect.left

      if (isPartiallyHidden) {
        step = trigger.offsetWidth
        break
      }
    }

    container.scrollBy({
      left: direction === 'left' ? -step : step,
      behavior: 'smooth'
    })
  }

  const labelBpClass =
    containerBreakpoint === "@2xl" ? "hidden @2xl:inline" :
      containerBreakpoint === "@xl" ? "hidden @xl:inline" :
        containerBreakpoint === "@lg" ? "hidden @lg:inline" :
          containerBreakpoint === "@md" ? "hidden @md:inline" :
            containerBreakpoint === "@sm" ? "hidden @sm:inline" :
              "hidden @xs:inline"

  const tooltipBpClass =
    containerBreakpoint === "@2xl" ? "@2xl:hidden" :
      containerBreakpoint === "@xl" ? "@xl:hidden" :
        containerBreakpoint === "@lg" ? "@lg:hidden" :
          containerBreakpoint === "@md" ? "@md:hidden" :
            containerBreakpoint === "@sm" ? "@sm:hidden" :
              "@xs:hidden"

  const paddingBpClass =
    containerBreakpoint === "@2xl" ? "@2xl:px-6" :
      containerBreakpoint === "@xl" ? "@xl:px-6" :
        containerBreakpoint === "@lg" ? "@lg:px-6" :
          containerBreakpoint === "@md" ? "@md:px-6" :
            containerBreakpoint === "@sm" ? "@sm:px-6" :
              "@xs:px-6"

  const surface = surfaceClassName ?? (dense ? "bg-secondary" : "bg-white/50 dark:bg-slate-900/50 border border-neutral-300 dark:border-neutral-800")
  const frameProps = dense
    ? { className: cn(radius, "w-full") }
    : { as: "div", speed: "2s", thickness: 2, isAnimate: isSaving, className: cn(radius, "w-full"), color: borderColor as any }
  const Frame: any = dense ? "div" : StarBorder
  return (
    <TabsRoot value={value}>
    <div className={cn("relative flex items-center", fullWidth ? "w-full" : maxWidth, className)}>
      <Frame {...frameProps}>
        <div className={cn("relative flex items-center w-full overflow-hidden backdrop-blur-sm", radius, surface)}>
          {showScrollButtons && showLeftArrow && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-0 top-1/2 -translate-y-1/2 z-20 h-9 w-9 rounded-lg bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm border-0 border-neutral-200 dark:border-neutral-800 hover:bg-white dark:hover:bg-black transition-all flex items-center justify-center"
              onClick={() => scroll('left')}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
          )}

          <PrimitiveTabsList
            ref={tabsListRef}
            onScroll={checkScroll}
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            className={cn("bg-transparent p-0 flex items-center justify-start gap-1 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden w-full scroll-smooth", dense ? "h-8 rounded-xl" : "h-9 rounded-3xl")}
          >
            <TooltipProvider delayDuration={0}>
              {items.map((tab) => (
                <Tooltip
                  key={`${tab.id}-${(showTooltips || labelsCollapsed)}`}
                  open={(showTooltips || labelsCollapsed) ? undefined : false}
                >
                  <TooltipTrigger asChild>
                    <TabsTrigger
                      value={tab.id}
                      disabled={tab.disabled}
                      onClick={() => { onValueChange?.(tab.id) }}
                      className={cn(
                        "relative flex-1 rounded-none font-black text-[10px] tracking-widest py-3.5 px-3 !bg-transparent data-[state=active]:!bg-transparent dark:data-[state=active]:!bg-transparent data-[state=active]:!shadow-none transition-all !border-none shrink-0 whitespace-nowrap",
                        dense ? "!py-1.5 !px-2.5 !text-[11px] !font-medium !tracking-normal" : paddingBpClass,
                        tab.colorCls,
                        dense ? "!text-muted-foreground hover:!text-foreground" : "!text-slate-500 hover:!text-slate-700 dark:hover:!text-slate-200",
                        value === tab.id ? (dense ? "font-semibold !text-brand-primary-dark dark:!text-brand-primary-light" : "font-bold") : "",
                        tab.disabled && "opacity-40 cursor-not-allowed"
                      )}
                    >
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        <tab.icon className="h-3.5 w-3.5" />
                        {showLabels &&
                          <span data-label className={labelBpClass}>{tab.label}</span>}
                      </span>
                      {value === tab.id && !isSaving && (
                        <motion.div
                          layoutId={`activeTabIndicator-${className}`}
                          transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                          className={cn("absolute bottom-[-1px] left-0 right-0 h-[3px] rounded-full z-10", tab.indicatorBg || (dense ? "bg-brand-primary" : "bg-indigo-500"))}
                        />
                      )}
                    </TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    className={cn("rounded-lg font-black text-[9px] tracking-widest bg-primary text-primary-foreground border-none py-1.5 px-3", tooltipBpClass)}
                  >
                    {tab.label}
                  </TooltipContent>
                </Tooltip>
              ))}
            </TooltipProvider>
          </PrimitiveTabsList>

          {showScrollButtons && showRightArrow && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-[1px] top-1/2 -translate-y-1/2 z-20 h-9 w-9 rounded-lg bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm border-0 border-neutral-200 dark:border-neutral-800 hover:bg-white dark:hover:bg-black transition-all flex items-center justify-center"
              onClick={() => scroll('right')}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </Frame>
    </div>
    </TabsRoot>
  )
}
