import type { ProjectEvidence, ProjectInput } from '@verdict/shared'
import { harvestRepo } from './github'
import { harvestVideo } from './youtube'

export * from './github'
export * from './youtube'
export * from './transcribe'
export * from './env'
export * from './proc'
export * from './cache'

export interface HarvestOptions {
  maxVideoMinutes?: number
  frameIntervalSeconds?: number
  signal?: AbortSignal
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

  if (project.github) {
    options.onLog?.(`[${project.name}] repository: ${project.github}`)
    try {
      evidence.repo = await harvestRepo(project.github, {
        signal: options.signal,
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
