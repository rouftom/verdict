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
  /** Per-call ceiling. Overridable so a test does not have to wait minutes. */
  timeoutMs?: number
}

/**
 * A dossier with six criteria easily fills 4k tokens, and reasoning models
 * spend part of the budget before writing the answer. The previous 4096 cap
 * truncated long evaluations mid-array, which the SDK reported as
 * `JSON Parse error: Expected ']'`.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 8192
/** The rejected answer sent back for a correction is bounded on purpose. */
const MAX_REPAIR_CHARS = 6000

/**
 * A provider that never answers must not freeze the run. Every call is bounded
 * by this ceiling, and the run cancellation still aborts immediately.
 */
export const MODEL_CALL_TIMEOUT_MS = 300_000

/**
 * Combine the run cancellation with a per-call timeout. `AbortSignal.timeout`
 * fires on its own; `AbortSignal.any` keeps the caller's abort working too, so
 * a cancelled run does not wait for the ceiling.
 */
export function callSignal(signal: AbortSignal | undefined, timeoutMs = MODEL_CALL_TIMEOUT_MS): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function usageOf(usage: unknown): UsageTotals {
  const source = (usage ?? {}) as Record<string, unknown>
  const input = Number(source.inputTokens ?? source.promptTokens ?? 0)
  const output = Number(source.outputTokens ?? source.completionTokens ?? 0)
  return { inputTokens: Number.isFinite(input) ? input : 0, outputTokens: Number.isFinite(output) ? output : 0, calls: 1 }
}

function addUsage(left: UsageTotals, right: UsageTotals): UsageTotals {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    calls: left.calls + right.calls,
  }
}

/** Models like to wrap JSON in a markdown fence even when told not to. */
function stripFences(text: string): string {
  let value = text.trim()
  const fence = /^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/.exec(value)
  if (fence?.[1]) value = fence[1].trim()
  value = value.replace(/^```(?:json|JSON)?\s*/, '').replace(/\s*```$/, '')
  return value.trim()
}

/**
 * Slice the first balanced object out of a response that may contain prose,
 * and tell the caller whether the closing brace was actually reached.
 */
function balancedSlice(text: string): { json: string; complete: boolean } | null {
  const start = text.search(/[{\[]/)
  if (start < 0) return null
  const stack: string[] = [text[start] === '{' ? '}' : ']']
  let inString = false
  let escaped = false
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') stack.push('}')
    else if (char === '[') stack.push(']')
    else if (char === '}' || char === ']') {
      const expected = stack[stack.length - 1]
      if (expected !== char) return { json: text.slice(start, index + 1), complete: false }
      stack.pop()
      if (stack.length === 0) return { json: text.slice(start, index + 1), complete: true }
    }
  }
  return { json: text.slice(start), complete: false }
}

/**
 * Close the strings and containers a truncated answer left open, and drop the
 * trailing comma a cut often leaves behind. The result is still checked by the
 * schema before it is trusted.
 */
export function repairJson(text: string): string {
  let out = ''
  const stack: string[] = []
  let inString = false
  let escaped = false

  for (const char of text) {
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '{') {
      stack.push('}')
      out += char
      continue
    }
    if (char === '[') {
      stack.push(']')
      out += char
      continue
    }
    if (char === '}' || char === ']') {
      if (stack[stack.length - 1] === char) stack.pop()
      out += char
      continue
    }
    out += char
  }

  if (inString) {
    if (escaped) out += '\\'
    out += '"'
  }
  while (stack.length > 0) {
    out = out.replace(/,\s*$/, '')
    // A cut right after `"key":` would leave an invalid member; null keeps the
    // field present and the schema rejects it explicitly instead of the parser.
    if (/:\s*$/.test(out)) out += 'null'
    out += stack.pop()
  }
  return out
}

/** Extract the JSON value from a free-form answer, repairing a truncated one. */
export function extractJson(text: string): string {
  const cleaned = stripFences(text)
  const slice = balancedSlice(cleaned)
  if (!slice) throw new Error('No JSON object in the model response.')
  try {
    JSON.parse(slice.json)
    return slice.json
  } catch {
    const repaired = repairJson(slice.json)
    JSON.parse(repaired)
    return repaired
  }
}

function contractOf<T>(options: StructuredOptions<T>): string {
  return options.jsonContract ?? JSON.stringify(schemaShape(options.schema))
}

/**
 * Structured generation with a JSON fallback. Some OpenAI-compatible gateways
 * do not implement tool/JSON mode; when the text fallback is invalid or does
 * not match the schema, one short correction round-trip gives the model the
 * exact reason instead of failing the whole evaluation.
 */
export async function generateStructured<T>(options: StructuredOptions<T>): Promise<StructuredResult<T>> {
  const { model, schema, system, prompt } = options
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  const nativeVideo = Boolean(options.videoUrl) && options.modelRef.provider === 'google'
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
            { type: 'file', data: new URL(options.videoUrl!), mediaType: 'video/mp4' },
          ],
        },
      ]
    : undefined

  const common = {
    model,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    maxOutputTokens,
    maxRetries: 1,
    abortSignal: callSignal(options.signal, options.timeoutMs),
  }

  try {
    const result = await generateObject({
      ...common,
      schema,
      system,
      ...(messages ? { messages } : { prompt }),
    })
    return { object: result.object as T, usage: usageOf(result.usage), mode: 'object' }
  } catch (objectError) {
    const fallback = await generateText({
      ...common,
      system: `${system}\n\nReturn only one JSON object that matches this contract. No markdown, no prose:\n${contractOf(options)}`,
      ...(messages ? { messages } : { prompt }),
    })

    let usage = usageOf(fallback.usage)
    try {
      const parsed = schema.parse(JSON.parse(extractJson(fallback.text)))
      return { object: parsed, usage, mode: 'json' }
    } catch (jsonError) {
      const reason = jsonError instanceof Error ? jsonError.message : String(jsonError)
      const correction = await generateText({
        ...common,
        system: `${system}\n\nYou repair invalid JSON. Return one complete JSON object only, with no markdown and no prose, matching this contract:\n${contractOf(options)}`,
        prompt: [
          'The previous answer was rejected.',
          `Reason: ${reason.slice(0, 400)}`,
          'Return the corrected object. Every required field must be present and every array must be closed.',
          '',
          'Previous answer:',
          fallback.text.slice(0, MAX_REPAIR_CHARS),
        ].join('\n'),
      })
      usage = addUsage(usage, usageOf(correction.usage))
      try {
        const parsed = schema.parse(JSON.parse(extractJson(correction.text)))
        return { object: parsed, usage, mode: 'json' }
      } catch (repairError) {
        const first = objectError instanceof Error ? objectError.message : String(objectError)
        const second = repairError instanceof Error ? repairError.message : String(repairError)
        throw new Error(`Structured generation failed: ${first} / JSON fallback: ${second}`)
      }
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
