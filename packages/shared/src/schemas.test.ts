import { describe, expect, test } from 'bun:test'
import { runOptionsSchema } from './schemas'

describe('runOptionsSchema', () => {
  test('caches harvested resources by default', () => {
    expect(runOptionsSchema.parse({}).cacheResources).toBe(true)
  })

  test('keeps an explicit opt-out', () => {
    expect(runOptionsSchema.parse({ cacheResources: false }).cacheResources).toBe(false)
  })
})
