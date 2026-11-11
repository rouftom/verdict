import { generateObject, generateText, type LanguageModel, type ModelMessage } from 'ai'
import type { z } from 'zod'
import { reasoningProviderOptions, supportsTemperature } from '@verdict/providers'
import type { ModelRef } from '@verdict/shared'

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  calls: number
}

export interface StructuredResult<T> {
  object: T
  usage: UsageTotals
  mode: 'object' | 'json'
}

export interface StructuredOptions<T> {
  model: LanguageModel
  modelRef: ModelRef
  schema: z.ZodType<T>
  system: string
  prompt: string
  /** Omit to use the provider default (some Claude 5.5 models reject it). */
  temperature?: number
  maxOutputTokens?: number
  /** Public video URL, passed natively only to providers that accept it. */
  videoUrl?: string
  /** Human-readable JSON contract used by the text fallback. */
  jsonContract?: string
  /** Abort the in-flight model call when the run is cancelled. */
  signal?: AbortSignal
}

function usageOf(usage: unknown): UsageTotals {
  const source = (usage ?? {}) as Record<string, unknown>
  const input = Number(source.inputTokens ?? source.promptTokens ?? 0)
  const output = Number(source.outputTokens ?? source.completionTokens ?? 0)
  return { inputTokens: Number.isFinite(input) ? input : 0, outputTokens: Number.isFinite(output) ? output : 0, calls: 1 }
}

function extractJson(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('No JSON object in the model response.')
  return text.slice(start, end + 1)
}

/**
 * Structured generation with a JSON fallback. Some OpenAI-compatible gateways
 * do not implement tool/JSON mode; the fallback keeps the pipeline usable.
 */
export async function generateStructured<T>(options: StructuredOptions<T>): Promise<StructuredResult<T>> {
  const { model, schema, system, prompt, maxOutputTokens = 4096, videoUrl } = options
  const nativeVideo = Boolean(videoUrl) && options.modelRef.provider === 'google'
  const providerOptions = reasoningProviderOptions(
    options.modelRef.provider,
    options.modelRef.reasoningEffort,
    options.modelRef.model,
  )
  const temperature = supportsTemperature(options.modelRef) ? options.temperature : undefined

  const messages: ModelMessage[] | undefined = nativeVideo
    ? [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'file', data: new URL(videoUrl!), mediaType: 'video/mp4' },
          ],
        },
      ]
    : undefined

  try {
    const result = await generateObject({
      model,
      schema,
      system,
      ...(messages ? { messages } : { prompt }),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      maxOutputTokens,
      maxRetries: 1,
      ...(options.signal ? { abortSignal: options.signal } : {}),
    })
    return { object: result.object as T, usage: usageOf(result.usage), mode: 'object' }
  } catch (objectError) {
    const fallback = await generateText({
      model,
      system: `${system}\n\nReturn only one JSON object that matches this contract. No markdown, no prose:\n${options.jsonContract ?? JSON.stringify(schemaShape(schema))}`,
      ...(messages ? { messages } : { prompt }),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      maxOutputTokens,
      maxRetries: 1,
      ...(options.signal ? { abortSignal: options.signal } : {}),
    })
    try {
      const parsed = schema.parse(JSON.parse(extractJson(fallback.text)))
      return { object: parsed, usage: usageOf(fallback.usage), mode: 'json' }
    } catch (jsonError) {
      const first = objectError instanceof Error ? objectError.message : String(objectError)
      const second = jsonError instanceof Error ? jsonError.message : String(jsonError)
      throw new Error(`Structured generation failed: ${first} / JSON fallback: ${second}`)
    }
  }
}

/** A compact shape hint without serialising the whole schema internals. */
function schemaShape(schema: z.ZodType<unknown>): unknown {
  try {
    const description = schema.description
    return { description: description ?? 'object matching the requested fields' }
  } catch {
    return { description: 'object' }
  }
}
