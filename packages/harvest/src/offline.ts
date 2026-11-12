import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { OfflineMapping, ProjectInput, RepoArtifact } from '@verdict/shared'
import { buildRepoArtifactFromDirectory, parseRepoUrl } from './github'
import { buildVideoArtifactFromFile, parseYouTubeUrl } from './youtube'
import { run } from './proc'

/**
 * Offline bundles: one zip holding every project repository and video. The API
 * unzips it once, then the run reads the extracted tree instead of the network.
 */

export interface OfflineProjectSource {
  /** Absolute directory holding the project repository. */
  directory?: string
  /** Absolute path of the project video. */
  videoFile?: string
}

export interface OfflineHarvest {
  /** Absolute directory of the extracted bundle. */
  root: string
  /** Project id to its sources; a missing entry becomes an evidence error. */
  projects: Record<string, OfflineProjectSource>
}

export interface OfflineFileEntry {
  /** Path relative to the bundle root, POSIX separators. */
  path: string
  /** Absolute path used to read the file. */
  absolute: string
  size: number
  ext: string
}

export interface OfflineBundleIndex {
  root: string
  files: OfflineFileEntry[]
  /** Candidate repository directories, absolute. */
  directories: string[]
  /** Every video file found in the bundle, absolute. */
  videos: string[]
  bytes: number
}

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'target',
  'vendor',
  '.turbo',
  '__pycache__',
  '__MACOSX',
  '.venv',
  'venv',
])

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.ogv'])
const TEXT_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.txt', '.md', '.markdown'])

/**
 * Repositories are often shipped as GitHub "Download ZIP" archives inside the
 * bundle. They are expanded into this hidden directory, which the bundle walk
 * skips, then added as repository roots.
 */
export const EXPANDED_DIRECTORY = '.verdict-expanded'

/** Folders the matching agent asked for, kept even when they came from a nested archive. */
const ONDEMAND_RECORD = 'ondemand.json'

/** A folder named like this is a subfolder of a repo, not a project root. */
const SOURCE_DIRECTORY_NAMES = new Set([
  'src',
  'app',
  'apps',
  'lib',
  'components',
  'public',
  'assets',
  'docs',
  'doc',
  'scripts',
  'test',
  'tests',
  'api',
  'web',
  'client',
  'server',
  'backend',
  'frontend',
  'pages',
  'styles',
  'config',
  'hooks',
  'utils',
  'types',
  'data',
  'media',
  'videos',
  'video',
  'static',
])

/** Files that mark a directory as a repository root rather than a subfolder. */
const REPO_MARKERS = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'composer.json',
  'gemfile',
  'index.html',
  'readme.md',
  'readme',
  'readme.txt',
  'agents.md',
])

function extensionOf(path: string): string {
  return extname(path).toLowerCase()
}

function isSkipped(name: string): boolean {
  return SKIP_DIRECTORIES.has(name) || (name.startsWith('.') && name !== '.')
}

function toPosix(value: string): string {
  return value.split(sep).join('/')
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function under(file: string, directory: string): boolean {
  const path = relative(directory, file)
  return Boolean(path) && !path.startsWith('..') && !isAbsolute(path)
}

/**
 * Walk the extracted tree once. A directory is a project-root candidate when
 * it holds at least one non-video file and is shallow, or carries a repo
 * marker. `src/`, `assets/` and a videos-only folder never become candidates.
 */
export async function indexOfflineBundle(
  root: string,
  limits: { maxFiles?: number; maxBytes?: number } = {},
): Promise<OfflineBundleIndex> {
  const maxFiles = limits.maxFiles ?? 50_000
  const maxBytes = limits.maxBytes ?? 16 * 1024 * 1024 * 1024
  const files: OfflineFileEntry[] = []
  const directories: string[] = []
  const videos: string[] = []
  let bytes = 0

  const walk = async (directory: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }

    const directFiles: Array<{ name: string; ext: string; size: number }> = []
    const directDirectories: string[] = []

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (isSkipped(entry.name)) continue
        directDirectories.push(entry.name)
        continue
      }
      if (!entry.isFile()) continue
      const absolute = join(directory, entry.name)
      let size = 0
      try {
        size = (await stat(absolute)).size
      } catch {
        continue
      }
      bytes += size
      if (files.length >= maxFiles || bytes > maxBytes) {
        throw new Error(`The offline bundle is above the ${maxFiles} file / ${Math.round(maxBytes / 1024 / 1024)} MB cap.`)
      }
      const ext = extensionOf(entry.name)
      const path = toPosix(relative(root, absolute))
      if (VIDEO_EXTENSIONS.has(ext)) {
        videos.push(absolute)
        continue
      }
      files.push({ path, absolute, size, ext })
      directFiles.push({ name: entry.name.toLowerCase(), ext, size })
    }

    const hasNonVideoFile = directFiles.length > 0
    const hasMarker = directFiles.some((file) => REPO_MARKERS.has(file.name))
    const isSourceFolder = depth >= 2 && SOURCE_DIRECTORY_NAMES.has(basename(directory).toLowerCase())
    // A videos-only directory or a nested `src/` is not a project root.
    if (hasNonVideoFile && !isSourceFolder && (depth <= 2 || hasMarker)) directories.push(directory)

    if (depth >= 6) return
    for (const name of directDirectories) {
      await walk(join(directory, name), depth + 1)
    }
  }

  await walk(root, 0)
  for (const directory of await expandedRepositoryDirectories(root)) {
    if (!directories.includes(directory)) directories.push(directory)
  }
  return { root, files, directories, videos, bytes }
}

interface CandidatePair {
  project: number
  candidate: number
  score: number
}

/** A repository or video the picker can offer, addressed by a stable path. */
export interface OfflineBundleCandidate {
  /** Path relative to the bundle root; `"."` is the root itself. */
  path: string
  label: string
}

export interface OfflineBundleCandidates {
  repositories: OfflineBundleCandidate[]
  videos: OfflineBundleCandidate[]
}

function relativePath(root: string, absolute: string): string {
  return toPosix(relative(root, absolute))
}

function normaliseRelative(value: string): string {
  const path = value.trim().split('\\').join('/').replace(/^\.\//, '').replace(/\/+$/, '')
  return path || '.'
}

/** Everything the manual picker and the matching agent may choose from. */
export function offlineBundleCandidates(index: OfflineBundleIndex): OfflineBundleCandidates {
  const candidate = (absolute: string): OfflineBundleCandidate => {
    const path = normaliseRelative(relativePath(index.root, absolute))
    return { path, label: path }
  }
  return {
    repositories: index.directories.map(candidate),
    videos: index.videos.map(candidate),
  }
}

function directoryIndexOf(index: OfflineBundleIndex, value: string): number {
  const wanted = normaliseRelative(value)
  return index.directories.findIndex((directory) => normaliseRelative(relativePath(index.root, directory)) === wanted)
}

function videoIndexOf(index: OfflineBundleIndex, value: string): number {
  const wanted = normaliseRelative(value)
  return index.videos.findIndex((video) => normaliseRelative(relativePath(index.root, video)) === wanted)
}

/** True when a hand-picked path still exists in the bundle. */
export function offlineCandidateExists(
  index: OfflineBundleIndex,
  kind: 'repository' | 'video',
  path: string,
): boolean {
  return kind === 'repository' ? directoryIndexOf(index, path) >= 0 : videoIndexOf(index, path) >= 0
}

function projectTokens(project: ProjectInput): string[] {
  const tokens = new Set<string>()
  const add = (value: string | undefined) => {
    const token = normalise(value ?? '')
    if (token.length >= 2) tokens.add(token)
  }
  add(project.name)
  add(project.id)
  if (project.github) {
    const ref = parseRepoUrl(project.github)
    if (ref) {
      add(ref.repo)
      add(`${ref.owner}-${ref.repo}`)
    }
  }
  if (project.youtube) {
    const ref = parseYouTubeUrl(project.youtube)
    if (ref) add(ref.id)
  }
  return [...tokens]
}

/** One insertion, deletion or substitution apart: the common typo distance. */
function nearlyEqual(left: string, right: string): boolean {
  if (left === right) return true
  if (Math.abs(left.length - right.length) > 1) return false
  const [short, long] = left.length <= right.length ? [left, right] : [right, left]
  let index = 0
  while (index < short.length && short[index] === long[index]) index += 1
  if (short.length === long.length) return short.slice(index + 1) === long.slice(index + 1)
  return short.slice(index) === long.slice(index + 1)
}

/**
 * Word-level agreement catches a manifest typo or a decorated filename such as
 * `Mini-<project> demo`. Two shared words are required, so a single generic
 * word is never enough.
 */
function scoreWords(token: string, name: string): number {
  const tokenWords = token.split('-').filter((word) => word.length >= 4)
  if (tokenWords.length < 2) return 0
  const nameWords = name.split('-').filter(Boolean)
  let matched = 0
  for (const word of tokenWords) {
    if (nameWords.some((candidate) => nearlyEqual(word, candidate))) matched += 1
  }
  if (matched < 2) return 0
  return 40 + Math.round(50 * (matched / tokenWords.length))
}

/** Compare a candidate name against the project's name, id, repo and video id. */
function scoreName(names: string[], tokens: string[]): number {
  let best = 0
  for (const token of tokens) {
    for (const name of names) {
      if (!name) continue
      if (name === token) {
        best = Math.max(best, 100)
        continue
      }
      if (name.includes(token) || token.includes(name)) {
        const ratio = Math.min(name.length, token.length) / Math.max(name.length, token.length)
        best = Math.max(best, 40 + Math.round(50 * ratio))
        continue
      }
      best = Math.max(best, scoreWords(token, name))
    }
  }
  return best
}

function assignPairs(pairs: CandidatePair[], usedProjects: Set<number>, usedCandidates: Set<number>): Map<number, number> {
  const assigned = new Map<number, number>()
  for (const pair of [...pairs].sort((left, right) => right.score - left.score)) {
    if (pair.score <= 0) break
    if (usedProjects.has(pair.project) || usedCandidates.has(pair.candidate)) continue
    usedProjects.add(pair.project)
    usedCandidates.add(pair.candidate)
    assigned.set(pair.project, pair.candidate)
  }
  return assigned
}

/**
 * Resolve each manifest project to a directory and a video. A manual match
 * wins; the automatic pass covers the rest, exact names first, then a
 * contained name, then the "one folder, one video" single-project layout. A
 * project with no match is left out on purpose: harvest records it as an
 * explicit evidence error instead of silently using the wrong files.
 */
export function mapOfflineBundle(
  index: OfflineBundleIndex,
  projects: ProjectInput[],
  manual: OfflineMapping = {},
): Record<string, OfflineProjectSource> {
  const sources: Record<string, OfflineProjectSource> = {}
  const directoryFor = new Map<number, number>()
  const videoFor = new Map<number, number>()
  const usedDirectories = new Set<number>()
  const usedVideos = new Set<number>()

  // A hand-picked or agent-suggested source is authoritative.
  for (const [projectIndex, project] of projects.entries()) {
    const match = manual[project.id]
    if (!match) continue
    if (match.repository) {
      const candidate = directoryIndexOf(index, match.repository)
      if (candidate >= 0 && !usedDirectories.has(candidate)) {
        directoryFor.set(projectIndex, candidate)
        usedDirectories.add(candidate)
      }
    }
    if (match.video) {
      const candidate = videoIndexOf(index, match.video)
      if (candidate >= 0 && !usedVideos.has(candidate)) {
        videoFor.set(projectIndex, candidate)
        usedVideos.add(candidate)
      }
    }
  }

  const dirNames = index.directories.map((directory) => [
    normalise(basename(directory)),
    normalise(toPosix(relative(index.root, directory))),
  ])

  const directoryPairs: CandidatePair[] = []
  for (const [projectIndex, project] of projects.entries()) {
    if (directoryFor.has(projectIndex)) continue
    const tokens = projectTokens(project)
    for (const [candidateIndex, names] of dirNames.entries()) {
      const score = scoreName(names.filter(Boolean), tokens)
      if (score > 0) directoryPairs.push({ project: projectIndex, candidate: candidateIndex, score })
    }
  }
  for (const [projectIndex, candidateIndex] of assignPairs(directoryPairs, new Set(directoryFor.keys()), usedDirectories)) {
    directoryFor.set(projectIndex, candidateIndex)
  }
  // A one-project bundle that keeps its files at the archive root (or in a
  // single folder) must still match, even when the folder has no useful name.
  if (projects.length === 1 && !directoryFor.has(0) && index.directories.length === 1) {
    directoryFor.set(0, 0)
    usedDirectories.add(0)
  }

  const videoNames = index.videos.map((video) => normalise(basename(video, extensionOf(video))))
  const videoPairs: CandidatePair[] = []

  // A project folder that holds exactly one video is unambiguous.
  for (const [projectIndex, project] of projects.entries()) {
    if (videoFor.has(projectIndex)) continue
    const directoryIndex = directoryFor.get(projectIndex)
    const scoped = index.videos
      .map((video, index) => ({ video, index }))
      .filter((entry) => directoryIndex !== undefined && under(entry.video, index.directories[directoryIndex]!))
    if (scoped.length === 1 && !usedVideos.has(scoped[0]!.index)) {
      videoFor.set(projectIndex, scoped[0]!.index)
      usedVideos.add(scoped[0]!.index)
      continue
    }
    const tokens = projectTokens(project)
    for (const [videoIndex, name] of videoNames.entries()) {
      if (usedVideos.has(videoIndex)) continue
      let score = scoreName([name], tokens)
      if (directoryIndex !== undefined && under(index.videos[videoIndex]!, index.directories[directoryIndex]!)) score += 15
      if (score > 0) videoPairs.push({ project: projectIndex, candidate: videoIndex, score })
    }
  }
  for (const [projectIndex, videoIndex] of assignPairs(videoPairs, new Set(videoFor.keys()), usedVideos)) {
    videoFor.set(projectIndex, videoIndex)
  }
  // Last resort for a one-project, one-video bundle whose names do not match.
  if (projects.length === 1 && !videoFor.has(0) && index.videos.length === 1) videoFor.set(0, 0)

  for (const [projectIndex, project] of projects.entries()) {
    const directoryIndex = directoryFor.get(projectIndex)
    const videoIndex = videoFor.get(projectIndex)
    const source: OfflineProjectSource = {
      ...(directoryIndex !== undefined ? { directory: index.directories[directoryIndex]! } : {}),
      ...(videoIndex !== undefined ? { videoFile: index.videos[videoIndex]! } : {}),
    }
    if (source.directory || source.videoFile) sources[project.id] = source
  }
  return sources
}

/** Turn an unmatched bundle into the harvest artifact for one project. */
export async function harvestOfflineProject(project: ProjectInput, directory: string): Promise<RepoArtifact> {
  const ref = project.github ? parseRepoUrl(project.github) : null
  return buildRepoArtifactFromDirectory(directory, {
    url: project.github ?? directory,
    ...(ref ? { owner: ref.owner, repo: ref.repo } : {}),
    ...(project.description ? { description: project.description } : {}),
  })
}

export { buildRepoArtifactFromDirectory, buildVideoArtifactFromFile }

/** Text files the input detector may read, manifest-like names first. */
export async function readOfflineTextCandidates(
  index: OfflineBundleIndex,
  options: { maxFiles?: number; maxBytes?: number } = {},
): Promise<Array<{ path: string; text: string }>> {
  const maxFiles = options.maxFiles ?? 120
  const maxBytes = options.maxBytes ?? 256 * 1024
  const priority = (path: string): number => {
    const lower = path.toLowerCase()
    if (/(manifest|projects?|winners?)/.test(lower)) return 0
    if (/(rule|guideline|judg|brief)/.test(lower)) return 1
    if (/(rubric|criteri|scor)/.test(lower)) return 2
    return 3
  }
  const chosen = index.files
    .filter((file) => TEXT_EXTENSIONS.has(file.ext) && file.size <= maxBytes)
    .sort((left, right) => priority(left.path) - priority(right.path) || left.path.localeCompare(right.path))
    .slice(0, maxFiles)

  const candidates: Array<{ path: string; text: string }> = []
  for (const file of chosen) {
    try {
      const text = (await readFile(file.absolute)).subarray(0, maxBytes).toString('utf8')
      if (text.trim()) candidates.push({ path: file.path, text })
    } catch {
      /* unreadable file: skip it */
    }
  }
  return candidates
}

export function unsafeZipEntry(entry: string): boolean {
  const normalised = entry.replace(/\\/g, '/')
  if (!normalised) return false
  if (normalised.startsWith('/')) return true
  if (/^[A-Za-z]:/.test(normalised)) return true
  return normalised.split('/').some((part) => part === '..')
}

/** `unzip` prints the absolute server path; never forward it to a client. */
export function archiveErrorMessage(stderr: string, archive: string, action: string): string {
  if (/cannot find zipfile directory|end-of-central-directory|not a zipfile|bad zipfile offset|invalid zip/i.test(stderr)) {
    return 'The uploaded file is not a valid zip archive.'
  }
  const cleaned = stderr.split(archive).join('the archive').replace(/\s+/g, ' ').trim()
  return cleaned ? `${action}: ${cleaned.slice(-300)}` : action
}

export function validateZipEntries(entries: string[]): void {
  if (entries.length > 100_000) throw new Error('The archive contains more than 100 000 entries.')
  const unsafe = entries.find(unsafeZipEntry)
  if (unsafe) throw new Error(`The archive contains an unsafe path: ${unsafe}`)
  const empty = entries.length === 0
  if (empty) throw new Error('The archive is empty.')
}

export interface ExtractZipOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

/** List and validate the archive before extraction, so zip-slip stops early. */
export async function extractZipArchive(archive: string, destination: string, options: ExtractZipOptions = {}): Promise<void> {
  const list = await run('unzip', ['-Z1', archive], {
    timeoutMs: options.timeoutMs ?? 60_000,
    maxBuffer: 32 * 1024 * 1024,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (list.code !== 0) throw new Error(archiveErrorMessage(list.stderr, archive, 'The archive could not be read.'))
  const entries = list.stdout.split('\n').map((entry) => entry.trim()).filter(Boolean)
  validateZipEntries(entries)

  await mkdir(destination, { recursive: true })
  const result = await run('unzip', ['-q', '-o', archive, '-d', destination], {
    timeoutMs: options.timeoutMs ?? 120_000,
    maxBuffer: 8 * 1024 * 1024,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (result.code !== 0) throw new Error(archiveErrorMessage(result.stderr, archive, 'The archive could not be extracted.'))
}

export interface ExpandArchivesOptions {
  /** Ceiling on how many nested archives are opened. */
  maxArchives?: number
  /** Ceiling on the total uncompressed size of every nested archive. */
  maxBytes?: number
  signal?: AbortSignal
}

export interface ExpandArchivesResult {
  /** Repository roots produced from nested archives, absolute. */
  directories: string[]
  warnings: string[]
}

async function directorySize(directory: string, limit: number): Promise<number> {
  let total = 0
  const walk = async (current: string): Promise<void> => {
    if (total > limit) return
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (total > limit) return
      if (entry.isSymbolicLink()) continue
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      try {
        total += (await stat(absolute)).size
      } catch {
        /* unreadable file: its size is unknown, so it does not count */
      }
    }
  }
  await walk(directory)
  return total
}

/**
 * A GitHub archive wraps everything in one folder. Use that folder as the
 * repository root so the README and the manifest files are found at the top.
 */
async function singleChildDirectory(directory: string): Promise<string | null> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const visible = entries.filter((entry) => !entry.name.startsWith('.'))
  if (visible.length !== 1 || !visible[0]!.isDirectory()) return null
  return join(directory, visible[0]!.name)
}

/**
 * Repositories produced from the bundle's own archives. A folder recorded
 * against an archive that itself lived under EXPANDED_DIRECTORY (an archive
 * shipped inside another repository) is not a project root: older bundles
 * expanded example zips there, and their files are noise for matching.
 */
async function expandedRepositoryDirectories(root: string): Promise<string[]> {
  const expandedRoot = join(root, EXPANDED_DIRECTORY)
  const record = await readArchiveRecord(join(expandedRoot, 'index.json'))
  const onDemand = new Set(
    (await readArchiveRecord(join(expandedRoot, ONDEMAND_RECORD)).then((entries) => Object.keys(entries))).map(
      (name) => name.toLowerCase(),
    ),
  )
  const nested = new Set(
    Object.entries(record)
      .filter(([archive]) => archive.startsWith(`${EXPANDED_DIRECTORY}/`))
      .map(([, name]) => name.toLowerCase())
      .filter((name) => !onDemand.has(name)),
  )
  const entries = await readdir(expandedRoot, { withFileTypes: true }).catch(() => [])
  const directories: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || nested.has(entry.name.toLowerCase())) continue
    const directory = join(expandedRoot, entry.name)
    directories.push((await singleChildDirectory(directory)) ?? directory)
  }
  return directories
}

/** Repositories are opened from any depth of the bundle itself. An archive
 * shipped inside another repository is left for the matching agent, which
 * opens it on demand through `unzip_archive`. */
const ARCHIVE_SCAN_DEPTH = 12

async function scanArchives(directory: string, found: string[] = [], depth = 0): Promise<string[]> {
  if (depth > ARCHIVE_SCAN_DEPTH || found.length >= 400) return found
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (found.length >= 400) break
    if (entry.isSymbolicLink()) continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (isSkipped(entry.name)) continue
      await scanArchives(absolute, found, depth + 1)
      continue
    }
    if (entry.isFile() && extensionOf(entry.name) === '.zip') found.push(absolute)
  }
  return found
}

/** Remember that a folder was extracted on demand rather than eagerly. */
async function markOnDemand(expandedRoot: string, name: string): Promise<void> {
  const path = join(expandedRoot, ONDEMAND_RECORD)
  const record = await readArchiveRecord(path)
  if (record[name]) return
  record[name] = 'on-demand'
  await writeFile(path, JSON.stringify(record, null, 2), 'utf8')
}

async function readArchiveRecord(path: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
  } catch {
    return {}
  }
}

export interface ExpandArchiveResult {
  /** Repository directory produced by this archive, absolute, when expanded. */
  directory?: string
  /** Uncompressed size accepted for this archive, 0 when it was reused. */
  bytes: number
  warnings: string[]
}

/**
 * Extract one archive under EXPANDED_DIRECTORY, once. The record keeps the
 * mapping from archive to folder so a later call reuses the tree instead of
 * extracting a duplicate under a new name. Callers bound the size budget.
 */
async function expandBundleArchive(
  root: string,
  archive: string,
  options: { maxBytes?: number; signal?: AbortSignal; onDemand?: boolean } = {},
): Promise<ExpandArchiveResult> {
  const warnings: string[] = []
  const expandedRoot = join(root, EXPANDED_DIRECTORY)
  await mkdir(expandedRoot, { recursive: true })
  const recordPath = join(expandedRoot, 'index.json')
  const record = await readArchiveRecord(recordPath)
  const planned = new Set<string>((await readdir(expandedRoot).catch(() => [])).map((name) => name.toLowerCase()))
  const label = toPosix(relative(root, archive))

  const recorded = record[label]
  if (recorded) {
    try {
      const existing = join(expandedRoot, recorded)
      await stat(existing)
      if (options.onDemand) await markOnDemand(expandedRoot, recorded)
      return { directory: (await singleChildDirectory(existing)) ?? existing, bytes: 0, warnings }
    } catch {
      /* the extracted tree was pruned: extract it again */
    }
  }

  const stem = normalise(basename(archive, extensionOf(archive))) || 'repo'
  let name = recorded ?? stem
  for (let suffix = 2; planned.has(name.toLowerCase()); suffix += 1) name = `${stem}-${suffix}`

  const target = join(expandedRoot, name)
  const partial = `${target}.partial`
  try {
    await rm(partial, { recursive: true, force: true })
    await extractZipArchive(archive, partial, options.signal ? { signal: options.signal } : {})
    const size = await directorySize(partial, options.maxBytes ?? 8 * 1024 * 1024 * 1024)
    if (size > (options.maxBytes ?? 8 * 1024 * 1024 * 1024)) {
      await rm(partial, { recursive: true, force: true })
      warnings.push(`${label} expands beyond the size budget and was skipped.`)
      return { bytes: 0, warnings }
    }
    await rename(partial, target)
    record[label] = name
    await writeFile(recordPath, JSON.stringify(record, null, 2), 'utf8')
    if (options.onDemand) await markOnDemand(expandedRoot, name)
    return { directory: (await singleChildDirectory(target)) ?? target, bytes: size, warnings }
  } catch (error) {
    await rm(partial, { recursive: true, force: true })
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`${label} could not be expanded: ${message}`)
    return { bytes: 0, warnings }
  }
}

/**
 * Expand the repository archives shipped in the bundle, at any depth. Nested
 * archives inside an extracted repository are not opened here: the matching
 * agent opens one through the `unzip_archive` tool when it needs to. One
 * unreadable archive never fails the bundle: it becomes a warning.
 */
export async function expandNestedArchives(
  root: string,
  options: ExpandArchivesOptions = {},
): Promise<ExpandArchivesResult> {
  const maxArchives = options.maxArchives ?? 60
  let budget = options.maxBytes ?? 8 * 1024 * 1024 * 1024
  const warnings: string[] = []
  const archives = await scanArchives(root)
  let capped = false

  for (const [index, archive] of archives.entries()) {
    if (index >= maxArchives || budget <= 0) {
      capped = true
      break
    }
    const result = await expandBundleArchive(root, archive, {
      maxBytes: budget,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    warnings.push(...result.warnings)
    budget -= result.bytes
  }

  if (capped) {
    warnings.push('The bundle holds more archives than the expansion budget allows; the remaining ones were not expanded.')
  }
  return { directories: await expandedRepositoryDirectories(root), warnings }
}

/**
 * The tools the matching agent may use on one cached bundle. Every path is
 * resolved inside the bundle root, every read is bounded, and an archive is
 * only opened on demand, so a big bundle costs nothing until the agent asks.
 */
export interface OfflineBundleEntry {
  name: string
  type: 'file' | 'directory'
  size?: number
}

export interface OfflineBundleListing {
  path: string
  entries: OfflineBundleEntry[]
  truncated: boolean
}

export interface OfflineBundleRead {
  path: string
  text: string
  truncated: boolean
}

export interface OfflineBundleReader {
  list(path: string): Promise<OfflineBundleListing>
  read(path: string, limit?: number): Promise<OfflineBundleRead>
  extract(path: string): Promise<{ directories: OfflineBundleCandidate[]; warnings: string[] }>
}

/** Text the agent may read. Anything else stays opaque and is never opened. */
const READABLE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.csv',
  '.html',
  '.htm',
  '.xml',
  '.py',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.scss',
  '.sh',
  '.sql',
  '.go',
  '.rs',
  '.rb',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.swift',
  '.php',
  '.vue',
  '.svelte',
  '.env.example',
  '.gitignore',
])

const READ_BYTES = 12 * 1024
const LIST_LIMIT = 200

function bundlePath(root: string, value: string): { relative: string; absolute: string } {
  const relativePath = value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '') || '.'
  if (isAbsolute(relativePath)) throw new Error(`"${value}" is not a path inside the bundle.`)
  const absolute = resolve(root, relativePath)
  if (absolute !== resolve(root) && !under(absolute, resolve(root))) {
    throw new Error(`"${value}" is not a path inside the bundle.`)
  }
  return { relative: relativePath, absolute }
}

export function createOfflineBundleReader(
  index: OfflineBundleIndex,
  options: { maxBytes?: number } = {},
): OfflineBundleReader {
  const root = resolve(index.root)
  // On-demand extractions share one budget, so a bundle cannot be unpacked
  // archive after archive by repeated tool calls.
  let budget = options.maxBytes ?? 2 * 1024 * 1024 * 1024
  let extractions = 0
  return {
    async list(value) {
      const { relative, absolute } = bundlePath(root, value)
      const entries = await readdir(absolute, { withFileTypes: true })
      const visible = entries
        .filter((entry) => !entry.isSymbolicLink() && !entry.name.startsWith('.'))
        .map((entry) => ({
          entry,
          directory: entry.isDirectory(),
        }))
        .sort((left, right) =>
          left.directory === right.directory
            ? left.entry.name.localeCompare(right.entry.name)
            : left.directory
              ? -1
              : 1,
        )
      const shown = visible.slice(0, LIST_LIMIT)
      const listing: OfflineBundleEntry[] = []
      for (const { entry, directory } of shown) {
        if (directory) {
          listing.push({ name: entry.name, type: 'directory' })
          continue
        }
        let size: number | undefined
        try {
          size = (await stat(join(absolute, entry.name))).size
        } catch {
          /* size is a hint, not a requirement */
        }
        listing.push({ name: entry.name, type: 'file', ...(size !== undefined ? { size } : {}) })
      }
      return { path: relative, entries: listing, truncated: visible.length > LIST_LIMIT }
    },

    async read(value, limit = 6_000) {
      const { relative, absolute } = bundlePath(root, value)
      const extension = extensionOf(absolute)
      if (!READABLE_EXTENSIONS.has(extension) && !READABLE_EXTENSIONS.has(basename(absolute).toLowerCase())) {
        throw new Error(`"${relative}" is not a readable text file.`)
      }
      const info = await stat(absolute)
      if (!info.isFile()) throw new Error(`"${relative}" is not a file.`)
      const handle = await open(absolute, 'r')
      try {
        const buffer = Buffer.alloc(Math.min(info.size, READ_BYTES))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        const text = buffer.subarray(0, bytesRead).toString('utf8')
        if (text.includes('\u0000')) throw new Error(`"${relative}" is a binary file.`)
        const clipped = text.slice(0, limit)
        return { path: relative, text: clipped, truncated: clipped.length < text.length || info.size > bytesRead }
      } finally {
        await handle.close()
      }
    },

    async extract(value) {
      const { relative, absolute } = bundlePath(root, value)
      if (extensionOf(absolute) !== '.zip') throw new Error(`"${relative}" is not a zip archive.`)
      if (extractions >= 6) throw new Error('The bundle agent already opened the maximum number of archives.')
      if (budget <= 0) throw new Error('The bundle agent reached its extraction size budget.')
      const result = await expandBundleArchive(root, absolute, { maxBytes: budget, onDemand: true })
      budget -= result.bytes
      extractions += 1
      return {
        directories: result.directory
          ? [{ path: normaliseRelative(relativePath(root, result.directory)), label: normaliseRelative(relativePath(root, result.directory)) }]
          : [],
        warnings: result.warnings,
      }
    },
  }
}
