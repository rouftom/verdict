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
  /**
   * Reject a parsed answer that is structurally valid but unusable, for
   * example an evaluation with no criterion scores. The text fallback and the
   * correction round then get the exact reason instead of returning zeros.
   */
  validate?: (value: T) => void
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
 * A provider that rejects a request option names the parameter in its error.
 * The run drops only the rejected option and retries, rather than losing the
 * whole evaluation because one gateway wants a default temperature or cannot
 * parse a reasoning level.
 */
const REASONING_OPTION_ERROR = /reasoning_effort|chat_template_kwargs/i
const TEMPERATURE_ERROR = /unsupported value: 'temperature'|temperature.*(?:not support|unsupported|only the default)/i

/** Walk the error chain: SDK wrappers nest the provider body several levels. */
function matchesErrorPattern(error: unknown, pattern: RegExp): boolean {
  const seen = new Set<unknown>()
  const stack: unknown[] = [error]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || seen.has(current)) continue
    seen.add(current)
    if (typeof current === 'string') {
      if (pattern.test(current)) return true
      continue
    }
    if (typeof current !== 'object') continue
    const record = current as Record<string, unknown>
    for (const key of ['message', 'responseBody', 'body', 'data', 'cause', 'error']) {
      if (record[key] !== undefined) stack.push(record[key])
    }
  }
  return false
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
  let temperature = supportsTemperature(options.modelRef) ? options.temperature : undefined
  let keepReasoning = Boolean(providerOptions)
  const abortSignal = callSignal(options.signal, options.timeoutMs)

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

  const buildCallOptions = () => ({
    model,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(keepReasoning && providerOptions ? { providerOptions } : {}),
    maxOutputTokens,
    maxRetries: 1,
    abortSignal,
  })
  // The fallback and correction calls reuse `common`. Dropping the rejected
  // option here also fixes every later call of this round.
  let common = buildCallOptions()

  /** Drop the options the provider just rejected; false means nothing to retry. */
  const dropRejectedOptions = (error: unknown): boolean => {
    let dropped = false
    if (temperature !== undefined && matchesErrorPattern(error, TEMPERATURE_ERROR)) {
      temperature = undefined
      dropped = true
    }
    if (keepReasoning && matchesErrorPattern(error, REASONING_OPTION_ERROR)) {
      keepReasoning = false
      dropped = true
    }
    if (dropped) common = buildCallOptions()
    return dropped
  }

  // Some OpenAI-compatible gateways only honour `response_format: json_object`
  // when the messages name JSON. A gateway may also ignore the schema entirely,
  // so the contract travels in the prompt as well: without it a model invents
  // its own keys and Zod silently defaults every score away.
  const objectSystem = `${system}\n\nReturn exactly one JSON object that matches this contract. No markdown, no prose:\n${contractOf(options)}`

  const objectCall = (callOptions: typeof common) =>
    generateObject({
      ...callOptions,
      schema,
      system: objectSystem,
      ...(messages ? { messages } : { prompt }),
    })

  const validate = (value: T) => options.validate?.(value)

  let objectResult: Awaited<ReturnType<typeof objectCall>> | undefined
  let objectError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await objectCall(common)
      validate(result.object as T)
      objectResult = result
      break
    } catch (error) {
      objectError = error
      if (!dropRejectedOptions(error)) break
    }
  }

  if (objectResult) {
    return { object: objectResult.object as T, usage: usageOf(objectResult.usage), mode: 'object' }
  }

  const textCall = async (systemText: string, promptText?: string, keepMedia = true) => {
    const build = (callOptions: typeof common) =>
      generateText({
        ...callOptions,
        system: systemText,
        ...(messages && keepMedia ? { messages } : { prompt: promptText ?? prompt }),
      })
    let textError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await build(common)
      } catch (error) {
        textError = error
        if (!dropRejectedOptions(error)) throw error
      }
    }
    throw textError
  }

  const fallback = await textCall(
    `${system}\n\nReturn only one JSON object that matches this contract. No markdown, no prose:\n${contractOf(options)}`,
  )

  let usage = usageOf(fallback.usage)
  try {
    const parsed = schema.parse(JSON.parse(extractJson(fallback.text)))
    validate(parsed)
    return { object: parsed, usage, mode: 'json' }
  } catch (jsonError) {
    const reason = jsonError instanceof Error ? jsonError.message : String(jsonError)
    const correction = await textCall(
      `${system}\n\nYou repair invalid JSON. Return one complete JSON object only, with no markdown and no prose, matching this contract:\n${contractOf(options)}`,
      [
        'The previous answer was rejected.',
        `Reason: ${reason.slice(0, 400)}`,
        'Return the corrected object. Every required field must be present and every array must be closed.',
        '',
        'Previous answer:',
        fallback.text.slice(0, MAX_REPAIR_CHARS),
      ].join('\n'),
      false,
    )
    usage = addUsage(usage, usageOf(correction.usage))
    try {
      const parsed = schema.parse(JSON.parse(extractJson(correction.text)))
      validate(parsed)
      return { object: parsed, usage, mode: 'json' }
    } catch (repairError) {
      const first = objectError instanceof Error ? objectError.message : String(objectError)
      const second = repairError instanceof Error ? repairError.message : String(repairError)
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
