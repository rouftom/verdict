'use client'

import { useEffect } from 'react'

interface ProcessingFaviconOptions {
  /** Base icon to decorate (default: the app icon). */
  baseIcon?: string
  /** Dot color; defaults to the active theme primary. */
  dotColor?: string
  /** Pulse the dot while a run is active. */
  animate?: boolean
  /** Canvas size in px. */
  size?: number
}

interface IconLinkSnapshot {
  el: HTMLLinkElement
  href: string | null
  type: string | null
  sizes: string | null
}

/**
 * Next.js renders several `rel="icon"` links (logo.svg, icon-192, icon-512).
 * The tab icon is only reliably replaced when every declared icon is swapped,
 * otherwise the browser keeps showing the untouched one.
 */
function getIconLinks(): HTMLLinkElement[] {
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'))
  if (links.length > 0) return links

  const link = document.createElement('link')
  link.rel = 'icon'
  document.head.appendChild(link)
  return [link]
}

function resolveDotColor(explicit?: string): string {
  if (explicit) return explicit
  if (typeof window === 'undefined') return '#0866FF'
  const css = getComputedStyle(document.documentElement)
  return (
    css.getPropertyValue('--charte-primary').trim() ||
    css.getPropertyValue('--primary').trim() ||
    '#0866FF'
  )
}

/**
 * Draws a small pulsing dot on the browser-tab favicon while `active` is true
 * (Vercel-style "background task" indicator). Restores the original icon when
 * inactive or on unmount. Works in Chrome/Firefox/Safari without a PWA install.
 *
 * Same pattern as the organization console, driven by the run status instead
 * of transcription jobs.
 */
export function useProcessingFavicon(active: boolean, options: ProcessingFaviconOptions = {}) {
  const { baseIcon = '/icons/icon-192.png', dotColor, animate = true, size = 64 } = options

  useEffect(() => {
    if (typeof window === 'undefined' || !active) return

    const links = getIconLinks()
    const snapshots: IconLinkSnapshot[] = links.map((el) => ({
      el,
      href: el.getAttribute('href'),
      type: el.getAttribute('type'),
      sizes: el.getAttribute('sizes'),
    }))

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const color = resolveDotColor(dotColor)
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    const draw = (img: HTMLImageElement, phase: number) => {
      ctx.clearRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)

      const wave = Math.abs(Math.sin(phase))
      const radius = (size / 7) * (animate ? 0.85 + 0.15 * wave : 1)
      const cx = size - radius - size / 24
      const cy = radius + size / 24

      ctx.globalAlpha = animate ? 0.65 + 0.35 * wave : 1
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.globalAlpha = 1

      ctx.lineWidth = Math.max(2, size / 24)
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'
      ctx.stroke()
    }

    const applyHref = () => {
      let url: string
      try {
        url = canvas.toDataURL('image/png')
      } catch {
        // Canvas tainted (should not happen for a same-origin icon): keep the base icon.
        return
      }
      links.forEach((el) => {
        el.setAttribute('href', url)
        // Force a PNG type so the browser does not reject the swapped icon on
        // links declared as `image/svg+xml`, and drop the size hint.
        el.setAttribute('type', 'image/png')
        el.removeAttribute('sizes')
      })
    }

    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      let phase = 0
      const render = () => {
        draw(img, phase)
        applyHref()
        phase += 0.6
      }
      render()
      if (animate) timer = setInterval(render, 450)
    }
    img.onerror = () => {
      // Keep the original favicon when the base image cannot be decoded.
    }
    img.src = baseIcon

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      snapshots.forEach(({ el, href, type, sizes }) => {
        if (href === null) el.removeAttribute('href')
        else el.setAttribute('href', href)
        if (type === null) el.removeAttribute('type')
        else el.setAttribute('type', type)
        if (sizes === null) el.removeAttribute('sizes')
        else el.setAttribute('sizes', sizes)
      })
    }
  }, [active, baseIcon, dotColor, animate, size])
}
