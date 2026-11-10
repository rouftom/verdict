import { parse as parseYaml } from 'yaml'
import { rawManifestSchema, rawProjectSchema } from './schemas'
import type { ManifestParseResult, ProjectInput } from './types'

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function shortHash(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36).slice(0, 6)
}

function cleanUrl(value: string | undefined): string | undefined {
  const raw = value?.trim()
  if (!raw) return undefined
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function toRank(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Math.trunc(Number(value))
  return undefined
}

/**
 * Parse a manifest from JSON or YAML, accepting an array or `{ projects: [] }`.
 * Field aliases are normalised so the sample `winners.json` and hand-written
 * manifests both work.
 */
export function parseManifestText(text: string): ManifestParseResult {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('The manifest is empty.')

  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    try {
      raw = parseYaml(trimmed)
    } catch {
      throw new Error('The manifest is neither valid JSON nor valid YAML.')
    }
  }

  const parsed = rawManifestSchema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`).join('; ')
    throw new Error(`Invalid manifest: ${detail}`)
  }

  const entries = Array.isArray(parsed.data) ? parsed.data : parsed.data.projects
  const warnings: string[] = []
  const projects: ProjectInput[] = []
  const seenIds = new Set<string>()

  for (const [index, entry] of entries.entries()) {
    const candidate = rawProjectSchema.parse(entry)
    const name = (candidate.name ?? candidate.title ?? candidate.project ?? '').trim()
    const github = cleanUrl(candidate.github ?? candidate.repo ?? candidate.repository)
    const youtube = cleanUrl(candidate.youtube ?? candidate.video ?? candidate.demo ?? candidate.demo_video)
    const track = (candidate.track ?? '').trim() || undefined
    const rank = toRank(candidate.rank)
    const description = candidate.description?.trim() || undefined

    if (!name) warnings.push(`Project ${index + 1}: no name.`)
    if (!github && !youtube) warnings.push(`Project ${index + 1} (${name || 'unnamed'}): no repository and no video.`)

    const seed = github ?? youtube ?? name ?? `project-${index}`
    let id = (candidate.id ?? '').trim() || `${slug(name || 'project')}-${shortHash(seed)}`
    if (seenIds.has(id)) {
      id = `${id}-${index + 1}`
      warnings.push(`Duplicate project id "${candidate.id ?? id}"; renamed to "${id}".`)
    }
    seenIds.add(id)

    const extra: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(candidate)) {
      if (!['id', 'name', 'title', 'project', 'rank', 'track', 'github', 'repo', 'repository', 'youtube', 'video', 'demo', 'demo_video', 'description', 'team'].includes(key)) {
        extra[key] = value
      }
    }

    projects.push({
      id,
      name: name || `Project ${index + 1}`,
      ...(rank !== undefined ? { rank } : {}),
      ...(track ? { track } : {}),
      ...(github ? { github } : {}),
      ...(youtube ? { youtube } : {}),
      ...(description ? { description } : {}),
      ...(toStringArray(candidate.team).length > 0 ? { team: toStringArray(candidate.team) } : {}),
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    })
  }

  if (projects.length === 0) throw new Error('The manifest contains no projects.')

  const perTrack = new Map<string, Set<number>>()
  for (const project of projects) {
    if (project.rank === undefined) continue
    const track = project.track ?? 'default'
    const ranks = perTrack.get(track) ?? new Set<number>()
    if (ranks.has(project.rank)) warnings.push(`Duplicate rank ${project.rank} in track "${track}". Ranks are per track; comparison must stay per track.`)
    ranks.add(project.rank)
    perTrack.set(track, ranks)
  }

  return { projects, warnings }
}

/** Re-exported for callers that want to validate a single entry. */
export { rawProjectSchema }
