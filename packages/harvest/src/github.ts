import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import * as tar from 'tar'
import type { CommitInfo, FileEntry, RepoArtifact } from '@verdict/shared'
import { env, temporaryDirectory, removeDirectory } from './env'
import { humanBytes } from './proc'

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

async function githubJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(20_000) })
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

interface WalkResult {
  files: FileEntry[]
  loc: number
  readme: string
  keyFiles: Array<{ path: string; content: string }>
}

async function walkRepository(root: string): Promise<WalkResult> {
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
}

/** Fetch a public repository as a tarball, then index it. No code is executed. */
export async function harvestRepo(value: string, options: HarvestRepoOptions = {}): Promise<RepoArtifact> {
  const ref = parseRepoUrl(value)
  if (!ref) throw new Error(`Unsupported repository URL: ${value}`)

  const maxBytes = options.maxBytes ?? Number(env('MAX_REPO_BYTES') || 60 * 1024 * 1024)
  const meta = await githubJson<RepoMeta>(`https://api.github.com/repos/${ref.owner}/${ref.repo}`)
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
    const languages = (await githubJson<LanguageMap>(`https://api.github.com/repos/${ref.owner}/${ref.repo}/languages`)) ?? {}
    const commitsRaw = (await githubJson<CommitApi[]>(`https://api.github.com/repos/${ref.owner}/${ref.repo}/commits?per_page=20`)) ?? []
    const commits: CommitInfo[] = commitsRaw.map((entry) => ({
      ...(entry.sha ? { sha: entry.sha.slice(0, 12) } : {}),
      message: (entry.commit?.message ?? '').split('\n')[0] ?? '',
      ...(entry.commit?.author?.date ? { date: entry.commit.author.date } : {}),
      ...(entry.commit?.author?.name ? { author: entry.commit.author.name } : {}),
    }))

    return {
      url: ref.url,
      owner: ref.owner,
      repo: ref.repo,
      ...(branch !== 'HEAD' ? { defaultBranch: branch } : {}),
      ...(meta?.description ? { description: meta.description } : {}),
      ...(meta?.license?.spdx_id || meta?.license?.name ? { license: meta.license.spdx_id ?? meta.license.name } : {}),
      ...(typeof meta?.stargazers_count === 'number' ? { stars: meta.stargazers_count } : {}),
      files: walked.files,
      tree: walked.files
        .slice(0, 400)
        .map((file) => `${file.path} (${humanBytes(file.size)})`)
        .join('\n'),
      readme: walked.readme,
      keyFiles: walked.keyFiles,
      filesCount: walked.files.length,
      loc: walked.loc,
      languages,
      commits,
      ...(meta?.created_at ? { firstCommitAt: meta.created_at } : {}),
      ...(meta?.pushed_at ? { lastCommitAt: meta.pushed_at } : {}),
      fetchedAt: new Date().toISOString(),
    }
  } finally {
    await removeDirectory(workspace)
  }
}
