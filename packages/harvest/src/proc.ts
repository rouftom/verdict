import { spawn } from 'node:child_process'

export interface RunResult {
  stdout: string
  stderr: string
  code: number
  timedOut: boolean
}

export interface RunOptions {
  timeoutMs?: number
  maxBuffer?: number
  cwd?: string
  env?: Record<string, string | undefined>
  /** Kill the child when the run is cancelled. */
  signal?: AbortSignal
}

/**
 * Run a trusted, argument-array command (never a shell string). Output is
 * capped; the child is killed on timeout.
 */
export function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? 120_000
  const maxBuffer = options.maxBuffer ?? 4 * 1024 * 1024
  if (options.signal?.aborted) {
    return Promise.resolve({ stdout: '', stderr: 'Cancelled.', code: -1, timedOut: false })
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    // A cancel must also stop yt-dlp and ffmpeg, not only the model calls.
    const onAbort = () => {
      child.kill('SIGKILL')
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (result: RunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < maxBuffer) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < maxBuffer) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => finish({ stdout, stderr, code: code ?? -1, timedOut }))
  })
}

export function seconds(value: number): string {
  return `${Math.max(0, Math.round(value))}s`
}

export function humanBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
