import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from './proc'

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

/** Materialise `YTDLP_COOKIES_BASE64` into a private temporary file. */
export async function cookiesFile(directory: string): Promise<string | undefined> {
  const encoded = env('YTDLP_COOKIES_BASE64')
  if (!encoded) return undefined
  try {
    const content = Buffer.from(encoded, 'base64').toString('utf8')
    if (!content.includes('\t')) return undefined
    const path = join(directory, 'cookies.txt')
    await writeFile(path, content, { mode: 0o600 })
    await chmod(path, 0o600)
    return path
  } catch {
    return undefined
  }
}

export function ytdlpPath(): string {
  return env('YTDLP_PATH') || 'yt-dlp'
}

export function ffmpegPath(): string {
  return env('FFMPEG_PATH') || 'ffmpeg'
}

export function ffprobePath(): string {
  return env('FFPROBE_PATH') || 'ffprobe'
}

export async function hasYtdlp(): Promise<boolean> {
  try {
    const result = await run(ytdlpPath(), ['--version'], { timeoutMs: 10_000 })
    return result.code === 0
  } catch {
    return false
  }
}

export async function temporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`))
}

export async function removeDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

export function stableId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export async function readText(path: string, maxBytes = 512 * 1024): Promise<string> {
  const buffer = await readFile(path)
  return buffer.subarray(0, maxBytes).toString('utf8')
}

export { env }
