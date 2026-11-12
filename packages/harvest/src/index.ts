import type { ProjectEvidence, ProjectInput } from '@verdict/shared'
import { harvestRepo } from './github'
import { harvestVideo, buildVideoArtifactFromFile } from './youtube'
import { harvestOfflineProject, type OfflineHarvest } from './offline'

export * from './github'
export * from './youtube'
export * from './transcribe'
export * from './env'
export * from './proc'
export * from './cache'
export * from './offline'

export interface HarvestOptions {
  maxVideoMinutes?: number
  frameIntervalSeconds?: number
  signal?: AbortSignal
  /** When false, every source is fetched again and the session cache is bypassed. */
  useCache?: boolean
  /**
   * When set, every source comes from the cached bundle. Nothing is fetched
   * from the network, and a project with no matching source is an explicit
   * evidence error rather than a silent fallback.
   */
  offline?: OfflineHarvest
  onLog?: (message: string) => void
}

/**
 * Build the evidence bundle for one project. A failure on one source never
 * hides the other: the error is recorded and the evaluation continues with
 * whatever was harvested.
 */
export async function harvestProject(project: ProjectInput, options: HarvestOptions = {}): Promise<ProjectEvidence> {
  const errors: string[] = []
  const evidence: ProjectEvidence = { projectId: project.id, errors }

  if (options.offline) {
    const source = options.offline.projects[project.id]

    if (source?.directory) {
      options.onLog?.(`[${project.name}] repository: offline bundle`)
      try {
        evidence.repo = await harvestOfflineProject(project, source.directory)
        options.onLog?.(`[${project.name}] repository indexed: ${evidence.repo.filesCount} files, ${evidence.repo.loc} LOC`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`repository: ${message}`)
        options.onLog?.(`[${project.name}] repository failed: ${message}`)
      }
    } else if (project.github) {
      const message = 'the offline bundle has no repository directory for this project.'
      errors.push(`repository: ${message}`)
      options.onLog?.(`[${project.name}] repository failed: ${message}`)
    }

    if (source?.videoFile) {
      options.onLog?.(`[${project.name}] video: offline bundle`)
      try {
        evidence.video = await buildVideoArtifactFromFile(source.videoFile, {
          maxMinutes: options.maxVideoMinutes,
          frameIntervalSeconds: options.frameIntervalSeconds,
          sourceUrl: project.youtube ?? source.videoFile,
          ...(options.signal ? { signal: options.signal } : {}),
        })
        const segments = evidence.video.transcript?.segments.length ?? 0
        options.onLog?.(`[${project.name}] video indexed: ${segments} transcript segments, ${evidence.video.frames.length} frames`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`video: ${message}`)
        options.onLog?.(`[${project.name}] video failed: ${message}`)
      }
    } else if (project.youtube) {
      const message = 'the offline bundle has no video for this project.'
      errors.push(`video: ${message}`)
      options.onLog?.(`[${project.name}] video failed: ${message}`)
    }

    if (!source?.directory && !source?.videoFile) {
      errors.push('No repository and no video found in the offline bundle for this project.')
    }
    return evidence
  }

  if (project.github) {
    options.onLog?.(`[${project.name}] repository: ${project.github}`)
    try {
      evidence.repo = await harvestRepo(project.github, {
        signal: options.signal,
        useCache: options.useCache,
        onSource: (source) =>
          options.onLog?.(
            source === 'cache'
              ? `[${project.name}] repository reused from the session cache, no download`
              : `[${project.name}] repository downloaded`,
          ),
      })
      options.onLog?.(`[${project.name}] repository indexed: ${evidence.repo.filesCount} files, ${evidence.repo.loc} LOC`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`repository: ${message}`)
      options.onLog?.(`[${project.name}] repository failed: ${message}`)
    }
  }

  if (project.youtube) {
    options.onLog?.(`[${project.name}] video: ${project.youtube}`)
    try {
      evidence.video = await harvestVideo(project.youtube, {
        maxMinutes: options.maxVideoMinutes,
        frameIntervalSeconds: options.frameIntervalSeconds,
        signal: options.signal,
        useCache: options.useCache,
        onSource: (source) =>
          options.onLog?.(
            source === 'cache'
              ? `[${project.name}] video reused from the session cache, no download`
              : `[${project.name}] video downloaded`,
          ),
      })
      const segments = evidence.video.transcript?.segments.length ?? 0
      options.onLog?.(`[${project.name}] video indexed: ${segments} transcript segments, ${evidence.video.frames.length} frames`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`video: ${message}`)
      options.onLog?.(`[${project.name}] video failed: ${message}`)
    }
  }

  if (!project.github && !project.youtube) errors.push('No repository and no video to evaluate.')
  return evidence
}
