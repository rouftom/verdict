import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { TranscriptArtifact, TranscriptSegment } from '@verdict/shared'
import { env, ffmpegPath } from './env'
import { run } from './proc'

export interface TranscriptionResult {
  transcript?: TranscriptArtifact
  error?: string
}

function baseUrl(): string {
  return env('TRANSCRIPTION_BASE_URL') || (env('GROQ_API_KEY') ? 'https://api.groq.com/openai/v1' : '')
}

function apiKey(): string {
  return env('TRANSCRIPTION_API_KEY') || env('GROQ_API_KEY')
}

function model(): string {
  return env('TRANSCRIPTION_MODEL') || env('GROQ_AUDIO_MODEL') || 'whisper-large-v3-turbo'
}

export function transcriptionConfigured(): boolean {
  return Boolean(baseUrl() && apiKey())
}

interface TranscriptionResponse {
  text?: string
  language?: string
  segments?: Array<{ start?: number; end?: number; text?: string }>
}

async function callEndpoint(filePath: string, offset: number, index: number): Promise<TranscriptionResponse> {
  const buffer = await readFile(filePath)
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: 'audio/mpeg' }), `segment-${index}.mp3`)
  form.append('model', model())
  form.append('response_format', 'verbose_json')

  const endpoint = `${baseUrl().replace(/\/+$/, '')}/audio/transcriptions`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Transcription endpoint returned ${response.status}${body ? `: ${body.slice(0, 240)}` : ''}`)
  }
  return (await response.json()) as TranscriptionResponse
}

/**
 * Transcribe a local video through any OpenAI-compatible audio endpoint
 * (Groq, OpenAI, a local gateway). The endpoint, key and model are all
 * environment-driven; no provider name is hard-coded in the pipeline.
 */
export async function transcribeVideo(
  videoPath: string,
  workDirectory: string,
  segmentSecondsOverride?: number,
): Promise<TranscriptionResult> {
  const configuredSegment = Number(env('TRANSCRIPTION_SEGMENT_SECONDS'))
  const segmentSeconds =
    segmentSecondsOverride ??
    (Number.isFinite(configuredSegment) && configuredSegment >= 5 ? configuredSegment : 30)
  if (!transcriptionConfigured()) {
    return { error: 'Transcription is not configured (TRANSCRIPTION_BASE_URL / TRANSCRIPTION_API_KEY).' }
  }

  try {
    const audio = join(workDirectory, 'audio.mp3')
    const extracted = await run(ffmpegPath(), ['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audio], { timeoutMs: 180_000 })
    if (extracted.code !== 0) return { error: `FFmpeg audio extraction failed: ${extracted.stderr.slice(-300)}` }

    const pattern = join(workDirectory, 'segment-%03d.mp3')
    const segmented = await run(
      ffmpegPath(),
      ['-y', '-i', audio, '-f', 'segment', '-segment_time', String(segmentSeconds), '-c:a', 'libmp3lame', '-b:a', '64k', pattern],
      { timeoutMs: 180_000 },
    )
    if (segmented.code !== 0) return { error: `FFmpeg segmentation failed: ${segmented.stderr.slice(-300)}` }

    const chunks = (await readdir(workDirectory))
      .filter((name) => name.startsWith('segment-') && name.endsWith('.mp3'))
      .sort()
    if (chunks.length === 0) return { error: 'No audio segment was produced.' }

    const segments: TranscriptSegment[] = []
    let language: string | undefined
    let failures = 0

    for (const [index, chunk] of chunks.entries()) {
      try {
        const result = await callEndpoint(join(workDirectory, chunk), index * segmentSeconds, index)
        if (result.language && !language) language = result.language
        if (Array.isArray(result.segments) && result.segments.length > 0) {
          for (const segment of result.segments) {
            segments.push({
              index: segments.length,
              start: index * segmentSeconds + (segment.start ?? 0),
              end: index * segmentSeconds + (segment.end ?? segmentSeconds),
              text: (segment.text ?? '').trim(),
            })
          }
        } else if (result.text?.trim()) {
          segments.push({
            index: segments.length,
            start: index * segmentSeconds,
            end: (index + 1) * segmentSeconds,
            text: result.text.trim(),
          })
        }
      } catch {
        failures += 1
      }
    }

    if (segments.length === 0) return { error: `Transcription failed for all ${chunks.length} segment(s).` }

    const text = segments.map((segment) => segment.text).join(' ').replace(/\s+/g, ' ').trim()
    return {
      transcript: {
        text,
        segments,
        model: model(),
        ...(language ? { language } : {}),
      },
      ...(failures > 0 ? { error: `${failures}/${chunks.length} audio segment(s) failed to transcribe.` } : {}),
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
