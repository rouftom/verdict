import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import * as tar from 'tar'
import type { CommitInfo, FileEntry, RepoArtifact } from '@verdict/shared'
import { env, temporaryDirectory, removeDirectory } from './env'
import { humanBytes } from './proc'
import { createSessionCache, repoCacheKey } from './cache'

export interface RepoRef {
  owner: string
  repo: string
  url: string
}

/** Accept `https://github.com/owner/repo`, `.git`, `/tree/...`; reject every other host. */
export function parseRepoUrl(value: string): RepoRef | null {
  try {
    const url = new URL(value)
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null
    const [owner, repo] = url.pathname.replace(/^\/+/, '').split('/')
    if (!owner || !repo) return null
    const cleanRepo = repo.replace(/\.git$/i, '')
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(cleanRepo)) return null
    return { owner, repo: cleanRepo, url: `https://github.com/${owner}/${cleanRepo}` }
  } catch {
    return null
  }
}

function headers(): Record<string, string> {
  const token = env('GITHUB_TOKEN')
  return {
    'User-Agent': 'verdict-evaluator',
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function githubJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: headers(),
      signal: signal ?? AbortSignal.timeout(20_000),
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'target', 'vendor', '.turbo', '__pycache__', '.venv', 'venv'])
const SKIP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tgz', '.mp4', '.mov', '.mp3', '.wav', '.woff', '.woff2', '.ttf', '.otf', '.so', '.dylib', '.dll', '.exe', '.bin'])
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.swift', '.c', '.h', '.cpp', '.hpp', '.sql', '.md', '.mdx', '.json', '.yaml', '.yml', '.toml', '.txt', '.sh', '.css', '.scss', '.html'])
const MAX_FILES = 6000
const MAX_KEY_FILE_BYTES = 160_000

function shouldSkip(path: string): boolean {
  const parts = path.split('/')
  if (parts.some((part) => SKIP_DIRECTORIES.has(part))) return true
  return SKIP_EXTENSIONS.has(extensionOf(path))
}

function extensionOf(path: string): string {
  const index = path.lastIndexOf('.')
  return index >= 0 ? path.slice(index).toLowerCase() : ''
}

export interface WalkResult {
  files: FileEntry[]
  loc: number
  readme: string
  keyFiles: Array<{ path: string; content: string }>
}

/** Repository indexing, shared by the online tarball and an offline directory. */
export async function walkRepository(root: string): Promise<WalkResult> {
  const files: FileEntry[] = []
  const text = new Map<string, string>()
  let loc = 0

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 12 || files.length >= MAX_FILES) return
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return
      const absolute = join(directory, entry.name)
      const path = relative(root, absolute).split(sep).join('/')
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        await walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile() || shouldSkip(path)) continue
      let size = 0
      try {
        size = (await stat(absolute)).size
      } catch {
        continue
      }
      files.push({ path, size, ext: extensionOf(path) })
      if (size <= 256 * 1024 && TEXT_EXTENSIONS.has(extensionOf(path))) {
        try {
          const content = await readFile(absolute, 'utf8')
          text.set(path, content)
          loc += content.split('\n').length
        } catch {
          /* binary or unreadable: ignore */
        }
      }
    }
  }

  await walk(root, 0)

  const lower = (path: string) => path.toLowerCase()
  const readmeEntry = files.find((file) => lower(file.path) === 'readme.md' || lower(file.path) === 'readme' || lower(file.path) === 'readme.txt')
  const readme = readmeEntry ? (text.get(readmeEntry.path) ?? '').slice(0, 24_000) : ''

  const priority = ['package.json', 'pyproject.toml', 'requirements.txt', 'cargo.toml', 'go.mod', 'dockerfile', 'docker-compose.yml', 'compose.yml', '.env.example', 'agents.md', 'license']
  const chosen = new Map<string, string>()
  for (const file of files) {
    const name = file.path.toLowerCase()
    if (priority.includes(name) && text.has(file.path)) chosen.set(file.path, (text.get(file.path) ?? '').slice(0, MAX_KEY_FILE_BYTES))
  }
  const sourceFiles = files
    .filter((file) => TEXT_EXTENSIONS.has(file.ext) && !file.path.toLowerCase().includes('test') && !file.path.toLowerCase().includes('spec'))
    .filter((file) => ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php'].includes(file.ext))
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, 12)
  for (const file of sourceFiles) {
    if (chosen.size >= 20) break
    if (!chosen.has(file.path)) chosen.set(file.path, (text.get(file.path) ?? '').slice(0, MAX_KEY_FILE_BYTES))
  }

  return {
    files,
    loc,
    readme,
    keyFiles: [...chosen.entries()].map(([path, content]) => ({ path, content })),
  }
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.swift': 'Swift',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.sql': 'SQL',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.html': 'HTML',
  '.md': 'Markdown',
  '.mdx': 'Markdown',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.sh': 'Shell',
}

/** Language totals for a directory harvest, which has no GitHub languages API. */
export function languagesFromFiles(files: FileEntry[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const file of files) {
    const language = LANGUAGE_BY_EXT[file.ext]
    if (!language) continue
    totals[language] = (totals[language] ?? 0) + file.size
  }
  return totals
}

export interface RepoArtifactMeta {
  url?: string
  owner?: string
  repo?: string
  defaultBranch?: string
  description?: string
  license?: string
  stars?: number
  languages?: Record<string, number>
  commits?: CommitInfo[]
  firstCommitAt?: string
  lastCommitAt?: string
  fetchedAt?: string
}

/**
 * Turn an indexed directory into the artifact the evaluators consume. Kept
 * separate from the network harvest so a local zip produces the same shape.
 */
export function repoArtifactFromWalk(walked: WalkResult, meta: RepoArtifactMeta): RepoArtifact {
  return {
    url: meta.url ?? '',
    owner: meta.owner ?? 'offline',
    repo: meta.repo ?? 'repository',
    ...(meta.defaultBranch ? { defaultBranch: meta.defaultBranch } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.license ? { license: meta.license } : {}),
    ...(typeof meta.stars === 'number' ? { stars: meta.stars } : {}),
    files: walked.files,
    tree: walked.files
      .slice(0, 400)
      .map((file) => `${file.path} (${humanBytes(file.size)})`)
      .join('\n'),
    readme: walked.readme,
    keyFiles: walked.keyFiles,
    filesCount: walked.files.length,
    loc: walked.loc,
    languages: meta.languages ?? languagesFromFiles(walked.files),
    commits: meta.commits ?? [],
    ...(meta.firstCommitAt ? { firstCommitAt: meta.firstCommitAt } : {}),
    ...(meta.lastCommitAt ? { lastCommitAt: meta.lastCommitAt } : {}),
    fetchedAt: meta.fetchedAt ?? new Date().toISOString(),
  }
}

/** Index a repository already present on disk, without touching the network. */
export async function buildRepoArtifactFromDirectory(root: string, meta: RepoArtifactMeta = {}): Promise<RepoArtifact> {
  const walked = await walkRepository(root)
  return repoArtifactFromWalk(walked, meta)
}

interface RepoMeta {
  default_branch?: string
  description?: string | null
  stargazers_count?: number
  created_at?: string
  pushed_at?: string
  license?: { spdx_id?: string; name?: string } | null
}

interface CommitApi {
  sha?: string
  commit?: { message?: string; author?: { name?: string; date?: string } }
}

interface LanguageMap {
  [language: string]: number
}

export interface HarvestRepoOptions {
  maxBytes?: number
  signal?: AbortSignal
  /** When false, the tarball is downloaded again instead of reusing the session cache. */
  useCache?: boolean
  /** Tells the caller whether the artifact came from the session cache. */
  onSource?: (source: 'cache' | 'network') => void
}

/** Approximate memory footprint of an artifact, used by the LRU bound. */
function weighRepo(artifact: RepoArtifact): number {
  const keyFiles = artifact.keyFiles.reduce((total, file) => total + file.content.length, 0)
  return artifact.readme.length + keyFiles + artifact.files.length * 96 + artifact.tree.length
}

const repoCache = createSessionCache<RepoArtifact>()

/**
 * Fetch a public repository as a tarball, then index it. No code is executed.
 * A second harvest of the same repository in the same session reuses the first
 * one instead of downloading the tarball again.
 */
export async function harvestRepo(value: string, options: HarvestRepoOptions = {}): Promise<RepoArtifact> {
  const ref = parseRepoUrl(value)
  if (!ref) throw new Error(`Unsupported repository URL: ${value}`)

  const maxBytes = options.maxBytes ?? Number(env('MAX_REPO_BYTES') || 60 * 1024 * 1024)
  if (options.useCache === false) {
    options.onSource?.('network')
    return harvestRepoUncached(ref, maxBytes, options)
  }
  const { value: artifact, hit } = await repoCache.load(
    repoCacheKey(ref.owner, ref.repo, maxBytes),
    () => harvestRepoUncached(ref, maxBytes, options),
    weighRepo,
  )
  options.onSource?.(hit ? 'cache' : 'network')
  return artifact
}

async function harvestRepoUncached(ref: RepoRef, maxBytes: number, options: HarvestRepoOptions): Promise<RepoArtifact> {
  const meta = await githubJson<RepoMeta>(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, options.signal)
  if (!meta && !env('GITHUB_TOKEN')) {
    // The API can be rate-limited without a token; the tarball may still work.
  }

  const branch = meta?.default_branch || 'HEAD'
  const tarballUrl = `https://codeload.github.com/${ref.owner}/${ref.repo}/tar.gz/${encodeURIComponent(branch)}`
  const response = await fetch(tarballUrl, { signal: options.signal ?? AbortSignal.timeout(90_000) })
  if (!response.ok) throw new Error(`Repository tarball returned ${response.status}.`)
  const announced = Number(response.headers.get('content-length') ?? 0)
  if (announced > maxBytes) throw new Error(`Repository tarball is ${humanBytes(announced)}, above the ${humanBytes(maxBytes)} cap.`)

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > maxBytes) throw new Error(`Repository tarball is ${humanBytes(buffer.byteLength)}, above the cap.`)

  const workspace = await temporaryDirectory('verdict-repo')
  try {
    const archive = join(workspace, 'repo.tar.gz')
    await writeFile(archive, buffer)
    const root = join(workspace, 'repo')
    await mkdir(root, { recursive: true })

    let extracted = 0
    const extractCap = maxBytes * 2
    await tar.x({
      file: archive,
      cwd: root,
      strip: 1,
      filter: (path, entry) => {
        const normalised = path.replace(/^\.\//, '')
        if (normalised.startsWith('/') || normalised.split('/').includes('..')) return false
        if (shouldSkip(normalised)) return false
        extracted += entry.size ?? 0
        return extracted <= extractCap
      },
    })

    const walked = await walkRepository(root)
    const languages = (await githubJson<LanguageMap>(`https://api.github.com/repos/${ref.owner}/${ref.repo}/languages`, options.signal)) ?? {}
    const commitsRaw = (await githubJson<CommitApi[]>(`https://api.github.com/repos/${ref.owner}/${ref.repo}/commits?per_page=20`, options.signal)) ?? []
    const commits: CommitInfo[] = commitsRaw.map((entry) => ({
      ...(entry.sha ? { sha: entry.sha.slice(0, 12) } : {}),
      message: (entry.commit?.message ?? '').split('\n')[0] ?? '',
      ...(entry.commit?.author?.date ? { date: entry.commit.author.date } : {}),
      ...(entry.commit?.author?.name ? { author: entry.commit.author.name } : {}),
    }))

    return repoArtifactFromWalk(walked, {
      url: ref.url,
      owner: ref.owner,
      repo: ref.repo,
      ...(branch !== 'HEAD' ? { defaultBranch: branch } : {}),
      ...(meta?.description ? { description: meta.description } : {}),
      ...(meta?.license?.spdx_id || meta?.license?.name ? { license: meta.license.spdx_id ?? meta.license.name } : {}),
      ...(typeof meta?.stargazers_count === 'number' ? { stars: meta.stargazers_count } : {}),
      languages,
      commits,
      ...(meta?.created_at ? { firstCommitAt: meta.created_at } : {}),
      ...(meta?.pushed_at ? { lastCommitAt: meta.pushed_at } : {}),
      fetchedAt: new Date().toISOString(),
    })
  } finally {
    await removeDirectory(workspace)
  }
}
