import type { OfflineMapping } from '@verdict/shared'

/**
 * Pure helpers shared by the workspace offline bundle panel and the arena one.
 * They only move mappings around; the API decides which paths exist.
 */

/** One bundle path feeds one project, whether it was picked by hand or by the agent. */
export function withMatch(
  mapping: OfflineMapping,
  projectId: string,
  kind: 'repository' | 'video',
  path: string,
): OfflineMapping {
  const next: OfflineMapping = {}
  for (const [id, match] of Object.entries(mapping)) next[id] = { ...match }
  if (path) {
    for (const [id, match] of Object.entries(next)) {
      if (id !== projectId && match[kind] === path) delete match[kind]
      if (!match.repository && !match.video) delete next[id]
    }
  }
  const match = { ...(next[projectId] ?? {}) }
  if (path) match[kind] = path
  else delete match[kind]
  if (match.repository || match.video) next[projectId] = match
  else delete next[projectId]
  return next
}

/**
 * The agent answers for the whole bundle; a hand-picked half still wins, and a
 * path picked by hand is never handed to a second project by the agent.
 */
export function applyAgentMapping(agent: OfflineMapping, manual: OfflineMapping): OfflineMapping {
  const next: OfflineMapping = {}
  for (const [id, match] of Object.entries(agent)) {
    if (match.repository || match.video) next[id] = { ...match }
  }
  for (const [id, match] of Object.entries(manual)) {
    next[id] = { ...(next[id] ?? {}), ...match }
  }
  const taken = { repository: new Set<string>(), video: new Set<string>() }
  for (const match of Object.values(manual)) {
    if (match.repository) taken.repository.add(match.repository)
    if (match.video) taken.video.add(match.video)
  }
  for (const [id, match] of Object.entries(next)) {
    const handPicked = manual[id] ?? {}
    if (match.repository && taken.repository.has(match.repository) && handPicked.repository !== match.repository) {
      delete match.repository
    }
    if (match.video && taken.video.has(match.video) && handPicked.video !== match.video) {
      delete match.video
    }
    if (!match.repository && !match.video) delete next[id]
  }
  return next
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

/** Last path segment, for a compact mapping summary. */
export function sourceLabel(path: string | undefined): string {
  return path ? path.split('/').pop() || path : ''
}

/** Paths already feeding another project, hidden from a row's picker. */
export function usedByOthers(
  mapping: OfflineMapping,
  projectId: string,
  kind: 'repository' | 'video',
): Set<string> {
  return new Set(
    Object.entries(mapping)
      .filter(([id]) => id !== projectId)
      .map(([, match]) => match[kind])
      .filter((path): path is string => Boolean(path)),
  )
}
