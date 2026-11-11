import { describe, expect, test } from 'bun:test'
import { callSignal, extractJson, repairJson } from './structured'

describe('JSON extraction', () => {
  test('reads a plain object', () => {
    expect(JSON.parse(extractJson('{"a":1}'))).toEqual({ a: 1 })
  })

  test('reads an object wrapped in a markdown fence or prose', () => {
    expect(JSON.parse(extractJson('```json\n{"a":1}\n```'))).toEqual({ a: 1 })
    expect(JSON.parse(extractJson('Here is the result:\n{"a":1}\nHope it helps.'))).toEqual({ a: 1 })
  })

  test('ignores braces inside strings', () => {
    const text = '{"summary":"a } inside a string","scores":[{"criterionId":"impact"}]}'
    expect(JSON.parse(extractJson(text))).toEqual({
      summary: 'a } inside a string',
      scores: [{ criterionId: 'impact' }],
    })
  })

  test('rejects a response without any JSON value', () => {
    expect(() => extractJson('I cannot answer that.')).toThrow('No JSON object in the model response.')
  })

  test('repairs an array truncated in the middle of an object', () => {
    const text = '{"scores":[{"criterionId":"impact","score":84,"rationale":"solid"},{"criterionId":"tooling","score":91'
    expect(JSON.parse(repairJson(text))).toEqual({
      scores: [
        { criterionId: 'impact', score: 84, rationale: 'solid' },
        { criterionId: 'tooling', score: 91 },
      ],
    })
  })

  test('repairs a trailing comma left by a cut', () => {
    expect(JSON.parse(repairJson('{"scores":[{"score":1},'))).toEqual({ scores: [{ score: 1 }] })
  })

  test('repairs a string cut mid-escape', () => {
    expect(JSON.parse(repairJson('{"notes":"line\\'))).toEqual({ notes: 'line\\' })
  })

  test('extractJson repairs a truncated response instead of failing', () => {
    const text = '{"scores":[{"criterionId":"impact","score":84},{"criterionId":"demo","score":'
    expect(JSON.parse(extractJson(text))).toEqual({
      scores: [
        { criterionId: 'impact', score: 84 },
        { criterionId: 'demo', score: null },
      ],
    })
  })
})

describe('callSignal', () => {
  test('fires on its own when a provider never answers', async () => {
    const signal = callSignal(undefined, 5)
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    expect(signal.aborted).toBe(true)
  })

  test('still aborts at once when the run is cancelled', () => {
    const run = new AbortController()
    const signal = callSignal(run.signal, 60_000)
    expect(signal.aborted).toBe(false)
    run.abort()
    expect(signal.aborted).toBe(true)
  })
})
