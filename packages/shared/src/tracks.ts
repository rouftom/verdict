import type { ProjectInput } from './types'

const DEFAULT_TRACK = 'default'

/**
 * Every ranking group a project belongs to, primary track first and without
 * duplicates. `tracks` is the new multi-track field; `track` stays supported so
 * older manifests keep working. A project without either ranks in `default`.
 */
export function projectTracks(project: ProjectInput): string[] {
  const values = [...(project.tracks ?? []), ...(project.track ? [project.track] : [])]
  const seen = new Set<string>()
  const tracks: string[] = []
  for (const value of values) {
    const track = value.trim()
    if (!track || seen.has(track)) continue
    seen.add(track)
    tracks.push(track)
  }
  return tracks.length > 0 ? tracks : [DEFAULT_TRACK]
}

/** The track that a supplied `rank` applies to, if any. */
export function primaryTrack(project: ProjectInput): string {
  return projectTracks(project)[0] ?? DEFAULT_TRACK
}

/**
 * Identity of one per-track scoring record. Scores, consensus and
 * verifications are produced once per project and track, so the track must be
 * part of every lookup key.
 */
export function scoreKey(projectId: string, track?: string): string {
  return track ? `${projectId}:${track}` : projectId
}
