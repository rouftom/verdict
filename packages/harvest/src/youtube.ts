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
  formats?: YtdlpFormat[]
}

/** One entry of the `formats` array that `yt-dlp -J` reports. */
export interface YtdlpFormat {
  format_id?: string
  ext?: string
  height?: number | null
  vcodec?: string | null
  acodec?: string | null
  tbr?: number | null
  abr?: number | null
  protocol?: string | null
}

export interface DownloadFormat {
  /** Expression passed to `yt-dlp -f`. */
  selector: string
  /** The selector merges separate streams, so ffmpeg is required. */
  merge: boolean
  /** Why this format won, kept for tests and error messages. */
  reason: string
}

const FALLBACK_FORMAT = (maxHeight: number) =>
  `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/bv*+ba/b`

const heightOf = (format: YtdlpFormat): number =>
  typeof format.height === 'number' && Number.isFinite(format.height) && format.height > 0 ? format.height : 0
const hasVideo = (format: YtdlpFormat): boolean => Boolean(format.vcodec) && format.vcodec !== 'none'
const hasAudio = (format: YtdlpFormat): boolean => Boolean(format.acodec) && format.acodec !== 'none'
const isMuxed = (format: YtdlpFormat): boolean => hasVideo(format) && hasAudio(format)
/** Storyboard and other non-media entries also carry a format_id. */
const isMedia = (format: YtdlpFormat): boolean =>
  Boolean(format.format_id) && !/mhtml/i.test(format.protocol ?? '') && (hasVideo(format) || hasAudio(format))
/** `-drc` entries are alternate loudness variants of an audio stream, not new media. */
const isDrc = (format: YtdlpFormat): boolean => /-drc$/i.test(format.format_id ?? '')
/**
 * A direct HTTPS stream downloads as one file, while an HLS (`m3u8_native`)
 * stream is fetched and merged fragment by fragment: slower and more brittle.
 * Prefer the direct rendition when both reach the same height.
 */
const isDirect = (format: YtdlpFormat): boolean => !/m3u8|dash/i.test(format.protocol ?? '')

/** Decoding h264 is cheaper and more portable than vp9 or av1. */
function codecPreference(format: YtdlpFormat): number {
  const codec = format.vcodec ?? ''
  if (codec.startsWith('avc1')) return 3
  if (codec.startsWith('vp9') || codec.startsWith('vp09')) return 2
  if (codec.startsWith('av01')) return 1
  return 0
}

/** Prefer a portable codec, then a direct stream, then mp4, then the lightest. */
function byVideoPreference(a: YtdlpFormat, b: YtdlpFormat): number {
  return (
    heightOf(b) - heightOf(a) ||
    codecPreference(b) - codecPreference(a) ||
    Number(isDirect(b)) - Number(isDirect(a)) ||
    Number(b.ext === 'mp4') - Number(a.ext === 'mp4') ||
    (a.tbr ?? 0) - (b.tbr ?? 0)
  )
}

/** Audio feeds the transcript, so prefer m4a, then a direct stream, then the highest bitrate. */
function byAudioPreference(a: YtdlpFormat, b: YtdlpFormat): number {
  return (
    Number(b.ext === 'm4a') - Number(a.ext === 'm4a') ||
    Number(isDirect(b)) - Number(isDirect(a)) ||
    (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0)
  )
}

/**
 * Pick the download format from the list `yt-dlp` reported instead of asking
 * for a hard-coded selector. YouTube does not serve every rendition for every
 * video: a video may have no muxed 360p mp4 at all and still offer 360p video
 * plus audio as separate streams, which is what `best[height<=360]` failed on.
 */
export function chooseDownloadFormat(formats: YtdlpFormat[] | undefined, maxHeight: number): DownloadFormat {
  const usable = (formats ?? []).filter((format) => isMedia(format) && !isDrc(format))
  if (usable.length === 0) {
    return { selector: FALLBACK_FORMAT(maxHeight), merge: true, reason: 'no format list' }
  }

  const muxed = usable
    .filter((format) => isMuxed(format) && heightOf(format) > 0 && heightOf(format) <= maxHeight)
    .sort(byVideoPreference)
  const muxedBest = muxed[0]
  if (muxedBest) {
    return { selector: muxedBest.format_id as string, merge: false, reason: `muxed ${heightOf(muxedBest)}p` }
  }

  // No muxed rendition at the cap: take a video-only stream at the cap plus
  // the best audio, which is how YouTube serves most renditions today.
  const videos = usable.filter((format) => hasVideo(format) && !hasAudio(format) && heightOf(format) > 0)
  const atCap = videos.filter((format) => heightOf(format) <= maxHeight).sort(byVideoPreference)
  const audio = usable.filter((format) => hasAudio(format) && !hasVideo(format)).sort(byAudioPreference)[0]
  if (atCap[0]) {
    const selector = audio ? `${atCap[0].format_id}+${audio.format_id}` : `${atCap[0].format_id}+bestaudio`
    return { selector, merge: true, reason: `${heightOf(atCap[0])}p video plus audio` }
  }

  // Everything is above the cap: take the smallest muxed stream rather than
  // fail, and only split streams when nothing is muxed.
  const muxedAbove = usable
    .filter((format) => isMuxed(format) && heightOf(format) > 0)
    .sort(
      (a, b) =>
        heightOf(a) - heightOf(b) ||
        Number(isDirect(b)) - Number(isDirect(a)) ||
        Number(b.ext === 'mp4') - Number(a.ext === 'mp4'),
    )
  const muxedSmallest = muxedAbove[0]
  if (muxedSmallest) {
    return { selector: muxedSmallest.format_id as string, merge: false, reason: `muxed ${heightOf(muxedSmallest)}p` }
  }

  const video = videos.sort(
    (a, b) =>
      heightOf(a) - heightOf(b) ||
      Number(isDirect(b)) - Number(isDirect(a)) ||
      Number(b.ext === 'mp4') - Number(a.ext === 'mp4'),
  )[0]
  if (!video) {
    return { selector: FALLBACK_FORMAT(maxHeight), merge: true, reason: 'no video stream' }
  }
  const selector = audio ? `${video.format_id}+${audio.format_id}` : `${video.format_id}+bestaudio`
  return { selector, merge: true, reason: `${heightOf(video)}p video plus audio` }
}


async function probe(ref: YouTubeRef, workDirectory: string, signal?: AbortSignal): Promise<Probe | null> {
  const cookies = await cookiesFile(workDirectory)
  const impersonate = env('YTDLP_IMPERSONATE')
  const extractorArgs = env('YTDLP_EXTRACTOR_ARGS')
  const result = await run(
    ytdlpPath(),
    [
      '-J',
      '--no-warnings',
      '--no-playlist',
      '--skip-download',
      ...(impersonate ? ['--impersonate', impersonate] : []),
      ...(extractorArgs ? ['--extractor-args', extractorArgs] : []),
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
    // Choose from the formats the probe actually saw: the hard-coded
    // `best[height<=360][ext=mp4]` chain fails when a video has no muxed
    // rendition at that height.
    const downloadFormat = chooseDownloadFormat(meta?.formats, maxHeight)
    const fallback: DownloadFormat = { selector: FALLBACK_FORMAT(maxHeight), merge: true, reason: 'fallback selector' }
    const downloadWith = (format: DownloadFormat) =>
      run(
        ytdlpPath(),
        [
          '--no-warnings',
          '--no-playlist',
          '--retries', '2',
          '--fragment-retries', '2',
          ...(impersonate ? ['--impersonate', impersonate] : []),
          ...(extractorArgs ? ['--extractor-args', extractorArgs] : []),
          '-f', format.selector,
          ...(format.merge ? ['--merge-output-format', 'mkv'] : []),
          '-o', template,
          ...(cookies ? ['--cookies', cookies] : []),
          ref.url,
        ],
        { timeoutMs: 15 * 60_000, maxBuffer: 2 * 1024 * 1024, ...(options.signal ? { signal: options.signal } : {}) },
      )
    let used = downloadFormat
    let downloaded = await downloadWith(downloadFormat)
    // The catalogue can change between the probe and the download. Retry once
    // with the generic selector instead of failing the whole project.
    if (downloaded.code !== 0 && downloadFormat.selector !== fallback.selector) {
      used = fallback
      downloaded = await downloadWith(fallback)
    }
    if (downloaded.code !== 0) {
      throw new Error(`yt-dlp download failed (${used.reason}): ${downloaded.stderr.slice(-400)}`)
    }

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
