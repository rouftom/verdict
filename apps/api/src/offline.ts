import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { modelPool, type ModelRef } from '@verdict/providers'
import {
  detectOfflineInputs,
  matchBundleWithAgent,
  type OfflineInputsDetection,
} from '@verdict/eval'
import {
  createOfflineBundleReader,
  expandNestedArchives,
  extractZipArchive,
  indexOfflineBundle,
  mapOfflineBundle,
  offlineBundleCandidates,
  offlineCandidateExists,
  readOfflineTextCandidates,
  type OfflineBundleCandidates,
  type OfflineBundleIndex,
  type OfflineHarvest,
} from '@verdict/harvest'
import {
  parseManifestText,
  type OfflineMapping,
  type ProjectInput,
} from '@verdict/shared'
import { config } from './config'

export interface OfflineInputsPayload {
  manifestText?: string
  manifestFilename?: string
  rulesText?: string
  rulesFilename?: string
  rubricText?: string
  rubricFilename?: string
}

export interface OfflineUploadResult {
  id: string
  label: string
  bytes: number
  files: number
  repos: number
  videos: number
  inputs: OfflineInputsPayload | null
  detected: { manifest: boolean; rules: boolean; rubric: boolean }
  /** Projects read from the detected manifest, so the picker can list them. */
  projects: Array<{ id: string; name: string }>
  /** Every repository and video the bundle holds, as bundle-relative paths. */
  candidates: OfflineBundleCandidates
  /** Automatic matches, already resolved against the detected manifest. */
  mapping: OfflineMapping
  warnings: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Keep a warning readable: the first names, then a count for the rest. */
export function listNames(names: string[], limit = 8): string {
  const shown = names.slice(0, limit).join(', ')
  return names.length > limit ? `${shown} and ${names.length - limit} more` : shown
}

export function offlineRoot(): string {
  return resolve(config.offlineCacheDir)
}

function bundleDirectory(id: string): string {
  if (!UUID.test(id)) throw new Error('Invalid offline bundle id.')
  return join(offlineRoot(), id)
}

/** The uploaded name is a label only; never a path. */
function safeLabel(label: string): string {
  const name = basename(label || 'bundle.zip').replace(/[^\w .-]/g, '')
  return name.trim() || 'bundle.zip'
}

async function writeStreamToFile(
  stream: AsyncIterable<Buffer | Uint8Array | string>,
  path: string,
  maxBytes: number,
): Promise<number> {
  const handle = await open(path, 'w')
  let total = 0
  try {
    for await (const chunk of stream) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
      total += buffer.byteLength
      if (total > maxBytes) {
        throw new Error(`The archive is above the ${Math.round(maxBytes / 1024 / 1024)} MB cap.`)
      }
      await handle.write(buffer)
    }
  } finally {
    await handle.close()
  }
  return total
}

/** One configured model is enough to fill detection gaps; none is fine too. */
async function detectionModel(): Promise<ModelRef | undefined> {
  const evaluators = await modelPool('EVAL_MODELS', 1)
  if (evaluators[0]) return evaluators[0]
  const verifiers = await modelPool('VERIFIER_MODELS', 1)
  return verifiers[0]
}

function inputsPayload(detection: OfflineInputsDetection): OfflineInputsPayload {
  return {
    ...(detection.manifest
      ? { manifestText: detection.manifest.text, manifestFilename: detection.manifest.filename }
      : {}),
    ...(detection.rules ? { rulesText: detection.rules.text, rulesFilename: detection.rules.filename } : {}),
    ...(detection.rubric ? { rubricText: detection.rubric.text, rubricFilename: detection.rubric.filename } : {}),
  }
}

/** Turn absolute harvest sources back into picker paths the run can reuse. */
function sourceMapping(
  index: OfflineBundleIndex,
  sources: Record<string, { directory?: string; videoFile?: string }>,
): OfflineMapping {
  const candidates = offlineBundleCandidates(index)
  const lookup = new Map<string, string>()
  for (const candidate of [...candidates.repositories, ...candidates.videos]) {
    lookup.set(resolve(index.root, candidate.path), candidate.path)
  }
  const mapping: OfflineMapping = {}
  for (const [projectId, source] of Object.entries(sources)) {
    const match: OfflineMapping[string] = {}
    if (source.directory) {
      const path = lookup.get(resolve(source.directory))
      if (path) match.repository = path
    }
    if (source.videoFile) {
      const path = lookup.get(resolve(source.videoFile))
      if (path) match.video = path
    }
    if (match.repository || match.video) mapping[projectId] = match
  }
  return mapping
}

/** A manual path that no longer exists must not silently produce an empty run. */
function mappingWarnings(index: OfflineBundleIndex, projects: ProjectInput[], mapping: OfflineMapping): string[] {
  const warnings: string[] = []
  const names = new Map(projects.map((project) => [project.id, project.name]))
  for (const [projectId, match] of Object.entries(mapping)) {
    const name = names.get(projectId)
    if (!name) {
      warnings.push(`The offline match for unknown project "${projectId}" was ignored.`)
      continue
    }
    if (match.repository && !offlineCandidateExists(index, 'repository', match.repository)) {
      warnings.push(`The bundle has no repository "${match.repository}" for ${name}; the match was ignored.`)
    }
    if (match.video && !offlineCandidateExists(index, 'video', match.video)) {
      warnings.push(`The bundle has no video "${match.video}" for ${name}; the match was ignored.`)
    }
  }
  return warnings
}

/** Expand and index a cached bundle; the same tree every run reads. */
async function loadOfflineIndex(id: string): Promise<{ index: OfflineBundleIndex; warnings: string[] }> {
  const extracted = join(bundleDirectory(id), 'extracted')
  try {
    await stat(extracted)
  } catch {
    throw new Error('Offline bundle not found. Upload it again before starting the run.')
  }
  const expansion = await expandNestedArchives(extracted, { maxBytes: config.offlineMaxBytes * 4 })
  const index = await indexOfflineBundle(extracted, {
    maxFiles: 50_000,
    maxBytes: config.offlineMaxBytes * 4,
  })
  return { index, warnings: expansion.warnings }
}

async function pruneBundles(keepId: string): Promise<void> {
  let entries
  try {
    entries = await readdir(offlineRoot(), { withFileTypes: true })
  } catch {
    return
  }
  const bundles: Array<{ id: string; modified: number }> = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue
    try {
      const info = await stat(join(offlineRoot(), entry.name))
      bundles.push({ id: entry.name, modified: info.mtimeMs })
    } catch {
      /* removed concurrently */
    }
  }
  bundles.sort((left, right) => right.modified - left.modified)
  for (const bundle of bundles.slice(config.offlineCacheLimit)) {
    if (bundle.id === keepId) continue
    await rm(join(offlineRoot(), bundle.id), { recursive: true, force: true })
  }
}

/**
 * Stream the zip to disk, validate it, unzip it, then detect the manifest,
 * rules and rubric. The extracted tree stays cached so a run can reference it
 * by id without uploading again.
 */
export async function ingestOfflineBundle(
  stream: AsyncIterable<Buffer | Uint8Array | string>,
  filename: string,
): Promise<OfflineUploadResult> {
  await mkdir(offlineRoot(), { recursive: true })
  const id = randomUUID()
  const directory = bundleDirectory(id)
  const archive = join(directory, 'bundle.zip')
  const extracted = join(directory, 'extracted')
  const label = safeLabel(filename)

  await mkdir(directory, { recursive: true })
  try {
    const bytes = await writeStreamToFile(stream, archive, config.offlineMaxBytes)
    if (bytes === 0) throw new Error('The uploaded archive is empty.')

    await extractZipArchive(archive, extracted)
    const expansion = await expandNestedArchives(extracted, { maxBytes: config.offlineMaxBytes * 4 })
    const index: OfflineBundleIndex = await indexOfflineBundle(extracted, {
      maxFiles: 50_000,
      maxBytes: config.offlineMaxBytes * 4,
    })
    if (index.files.length === 0 && index.videos.length === 0) {
      throw new Error('The archive contains no readable file.')
    }

    const candidates = await readOfflineTextCandidates(index)
    const modelRef = await detectionModel()
    const detection = await detectOfflineInputs(candidates, modelRef ? { modelRef } : {})
    const inputs = inputsPayload(detection)
    const detected = {
      manifest: Boolean(detection.manifest),
      rules: Boolean(detection.rules),
      rubric: Boolean(detection.rubric),
    }
    const warnings = [...detection.warnings, ...expansion.warnings]

    // With a manifest in hand, say up front which projects the bundle cannot
    // feed, and return the automatic matches so the UI can show the leftovers.
    let repos = Math.max(1, index.directories.filter((directory) => directory !== index.root).length)
    let projects: Array<{ id: string; name: string }> = []
    let mapping: OfflineMapping = {}
    if (detection.manifest) {
      try {
        const parsed = parseManifestText(detection.manifest.text)
        projects = parsed.projects.map((project) => ({ id: project.id, name: project.name }))
        const sources = mapOfflineBundle(index, parsed.projects)
        mapping = sourceMapping(index, sources)
        const missing = parsed.projects.filter((project) => !sources[project.id]).map((project) => project.name)
        repos = new Set(
          Object.values(sources)
            .map((source) => source.directory)
            .filter((directory): directory is string => Boolean(directory)),
        ).size
        if (missing.length > 0) {
          warnings.push(
            `The bundle has a repository or video for ${parsed.projects.length - missing.length} of ${parsed.projects.length} project(s). Unmatched: ${listNames(missing)}. Match them by hand or with the matching agent.`,
          )
        }
      } catch {
        /* the manifest parses in the run; leave the count as the directory count */
      }
    }
    const bundleCandidates = offlineBundleCandidates(index)

    await writeFile(
      join(directory, 'meta.json'),
      JSON.stringify(
        {
          id,
          label,
          bytes,
          files: index.files.length,
          repos,
          videos: index.videos.length,
          detected,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    )
    await pruneBundles(id)

    return {
      id,
      label,
      bytes,
      files: index.files.length,
      repos,
      videos: index.videos.length,
      inputs: Object.keys(inputs).length > 0 ? inputs : null,
      detected,
      projects,
      candidates: bundleCandidates,
      mapping,
      warnings,
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

/**
 * Resolve a cached bundle against the manifest used by a run. Explicit matches
 * (hand-picked or suggested by the agent) win; the automatic pass fills the
 * rest. Expanding the nested archives is idempotent, so a bundle uploaded
 * before this step existed still works on its first run.
 */
export async function prepareOfflineHarvest(
  id: string,
  manifest: ProjectInput[],
  mapping: OfflineMapping = {},
): Promise<{ harvest: OfflineHarvest; warnings: string[] }> {
  const { index, warnings } = await loadOfflineIndex(id)
  return {
    harvest: { root: index.root, projects: mapOfflineBundle(index, manifest, mapping) },
    warnings: [...warnings, ...mappingWarnings(index, manifest, mapping)],
  }
}

/**
 * Run the bundle agent on one cached bundle. The agent sees the whole
 * candidate set and the name-based matches, inspects README files or opens an
 * archive when it needs to, and returns a complete mapping. Every path it
 * returns is checked against the bundle, so a suggestion can never point
 * outside the index.
 */
export async function suggestOfflineMatches(
  id: string,
  manifestText: string,
  modelRef?: ModelRef,
): Promise<{ mapping: OfflineMapping; notes: string; warnings: string[] }> {
  const { index, warnings } = await loadOfflineIndex(id)
  const projects = parseManifestText(manifestText).projects
  const candidates = offlineBundleCandidates(index)
  const seed = sourceMapping(index, mapOfflineBundle(index, projects))

  const result = await matchBundleWithAgent(
    {
      projects,
      repositories: candidates.repositories.map((candidate) => candidate.path),
      videos: candidates.videos.map((candidate) => candidate.path),
      seed,
      reader: createOfflineBundleReader(index, { maxBytes: config.offlineMaxBytes * 2 }),
    },
    modelRef ? { modelRef } : {},
  )
  return { mapping: result.mapping, notes: result.notes, warnings: [...warnings, ...result.warnings] }
}
