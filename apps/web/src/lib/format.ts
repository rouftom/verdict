export function formatDate(value: string | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatDuration(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return '-'
  const minutes = Math.floor(value / 60)
  const seconds = Math.round(value % 60)
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function scoreTone(score: number): 'success' | 'brand' | 'warning' | 'danger' {
  if (score >= 75) return 'success'
  if (score >= 55) return 'brand'
  if (score >= 35) return 'warning'
  return 'danger'
}

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** Compact token count: 950, 12.4k, 1.3M. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return String(Math.round(value))
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

export function typeOfModel(ref: { provider: string; model: string }): string {
  return `${ref.provider}:${ref.model}`
}
