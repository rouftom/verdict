import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { FrameEvidence, VideoArtifact } from '@verdict/shared'
import { cookiesFile, env, ffmpegPath, hasYtdlp, temporaryDirectory, removeDirectory, ytdlpPath } from './env'
import { run } from './proc'
import { transcribeVideo } from './transcribe'

export interface YouTubeRef {
  id: string
  url: string
}

/** Accept watch, youtu.be, shorts and embed URLs; reject every other host. */
export function parseYouTubeUrl(value: string): YouTubeRef | null {
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^www\./, '')
    let id = ''
    if (host === 'youtu.be') id = url.pathname.replace(/^\/+/, '').split('/')[0] ?? ''
    else if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v') ?? ''
      else {
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') id = parts[1] ?? ''
      }
    }
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null
    return { id, url: `https://www.youtube.com/watch?v=${id}` }
  } catch {
    return null
  }
}

interface Probe {
  title?: string
  duration?: number
  uploader?: string
  thumbnail?: string
}

async function probe(ref: YouTubeRef, workDirectory: string, signal?: AbortSignal): Promise<Probe | null> {
  const cookies = await cookiesFile(workDirectory)
  const result = await run(
    ytdlpPath(),
    [
      '-J',
      '--no-warnings',
      '--no-playlist',
      '--skip-download',
      ...(cookies ? ['--cookies', cookies] : []),
      ref.url,
    ],
    { timeoutMs: 90_000, maxBuffer: 8 * 1024 * 1024, ...(signal ? { signal } : {}) },
  )
  if (result.code !== 0) return null
  try {
    return JSON.parse(result.stdout) as Probe
  } catch {
    return null
  }
}

export interface HarvestVideoOptions {
  maxMinutes?: number
  frameIntervalSeconds?: number
  maxFrames?: number
  signal?: AbortSignal
}

/** Download a public video, extract frames, then transcribe it. */
export async function harvestVideo(value: string, options: HarvestVideoOptions = {}): Promise<VideoArtifact> {
  const ref = parseYouTubeUrl(value)
  if (!ref) throw new Error(`Unsupported video URL: ${value}`)
  if (!(await hasYtdlp())) {
    throw new Error(`yt-dlp is not available (YTDLP_PATH=${ytdlpPath()}). Install it or set YTDLP_COOKIES_BASE64/YTDLP_PATH.`)
  }

  const maxMinutes = options.maxMinutes ?? Number(env('MAX_VIDEO_MINUTES') || 20)
  const frameInterval = Math.max(2, options.frameIntervalSeconds ?? 20)
  const maxFrames = Math.max(1, options.maxFrames ?? Number(env('FRAME_MAX') || 24))
  // Frames are the only thing the evaluators look at, so a 360p download is
  // enough. `YTDLP_MAX_HEIGHT` raises it when a closer read is needed.
  const requestedHeight = Number(env('YTDLP_MAX_HEIGHT') || 360)
  const maxHeight = Number.isFinite(requestedHeight) && requestedHeight >= 144 ? Math.round(requestedHeight) : 360
  const workspace = await temporaryDirectory('verdict-video')

  try {
    const meta = await probe(ref, workspace, options.signal)
    if (typeof meta?.duration === 'number' && meta.duration > maxMinutes * 60) {
      throw new Error(`Video is ${Math.round(meta.duration / 60)} min, above the ${maxMinutes} min cap.`)
    }

    const cookies = await cookiesFile(workspace)
    const template = join(workspace, 'video.%(ext)s')
    const impersonate = env('YTDLP_IMPERSONATE')
    const extractorArgs = env('YTDLP_EXTRACTOR_ARGS')
    const downloaded = await run(
      ytdlpPath(),
      [
        '--no-warnings',
        '--no-playlist',
        '--retries', '2',
        '--fragment-retries', '2',
        ...(impersonate ? ['--impersonate', impersonate] : []),
        ...(extractorArgs ? ['--extractor-args', extractorArgs] : []),
        '-f', `best[height<=${maxHeight}][ext=mp4]/best[height<=${maxHeight}]/best`,
        '-o', template,
        ...(cookies ? ['--cookies', cookies] : []),
        ref.url,
      ],
      { timeoutMs: 15 * 60_000, maxBuffer: 2 * 1024 * 1024, ...(options.signal ? { signal: options.signal } : {}) },
    )
    if (downloaded.code !== 0) throw new Error(`yt-dlp download failed: ${downloaded.stderr.slice(-400)}`)

    const files = await readdir(workspace)
    const videoFile = files.find((name) => name.startsWith('video.') && /\.(mp4|mkv|webm|mov)$/i.test(name))
    if (!videoFile) throw new Error('yt-dlp produced no video file.')
    const videoPath = join(workspace, videoFile)

    const framesDirectory = join(workspace, 'frames')
    const framesResult = await run(
      ffmpegPath(),
      [
        '-y',
        '-i', videoPath,
        '-vf', `fps=1/${frameInterval},scale=640:-2`,
        '-frames:v', String(maxFrames),
        '-q:v', '3',
        join(framesDirectory, 'frame-%03d.jpg'),
      ],
      { timeoutMs: 10 * 60_000, ...(options.signal ? { signal: options.signal } : {}) },
    )
    if (framesResult.code !== 0) throw new Error(`FFmpeg frame extraction failed: ${framesResult.stderr.slice(-300)}`)

    const frameFiles = (await readdir(framesDirectory)).filter((name) => name.endsWith('.jpg')).sort()
    const frames: FrameEvidence[] = frameFiles.map((name, index) => ({
      index,
      atSeconds: index * frameInterval,
      // Logical reference: the pixel files live in the ephemeral workspace.
      path: `${ref.url}#frame-${index}@${index * frameInterval}s`,
      caption: `Keyframe at ${index * frameInterval}s (${name}).`,
    }))

    const transcription = await transcribeVideo(videoPath, workspace, undefined, options.signal)

    return {
      url: ref.url,
      ...(meta?.title ? { title: meta.title } : {}),
      ...(typeof meta?.duration === 'number' ? { duration: meta.duration } : {}),
      ...(meta?.uploader ? { uploader: meta.uploader } : {}),
      ...(meta?.thumbnail ? { thumbnail: meta.thumbnail } : {}),
      ...(transcription.transcript ? { transcript: transcription.transcript } : {}),
      frames,
      fetchedAt: new Date().toISOString(),
    }
  } finally {
    // Frames are copied out by the caller before cleanup when it needs them;
    // the transcript and metadata are already in memory.
    await removeDirectory(workspace)
  }
}
