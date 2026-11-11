import { describe, expect, test } from 'bun:test'
import { runOptionsSchema, stageOneOutputSchema } from './schemas'

describe('runOptionsSchema', () => {
  test('caches harvested resources by default', () => {
    expect(runOptionsSchema.parse({}).cacheResources).toBe(true)
  })

  test('keeps an explicit opt-out', () => {
    expect(runOptionsSchema.parse({ cacheResources: false }).cacheResources).toBe(false)
  })
})

describe('stageOneOutputSchema', () => {
  test('requires both gate checks', () => {
    expect(stageOneOutputSchema.parse({ themeFit: true, toolingUse: true }).rationale).toBe('')
    expect(() => stageOneOutputSchema.parse({ themeFit: true })).toThrow()
  })
})
