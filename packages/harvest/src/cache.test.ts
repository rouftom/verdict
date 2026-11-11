import { describe, expect, test } from 'bun:test'
import { SessionCache, repoCacheKey, videoCacheKey } from './cache'

describe('cache keys', () => {
  test('normalises repository identity across URL spellings and case', () => {
    const left = repoCacheKey('RoufTom', 'Verdict', 1_024)
    const right = repoCacheKey('rouftom', 'verdict', 1_024)
    expect(left).toBe(right)
    expect(left).toContain('rouftom/verdict')
  })

  test('keeps the size cap in the key so a raised cap refetches', () => {
    expect(repoCacheKey('a', 'b', 1)).not.toBe(repoCacheKey('a', 'b', 2))
  })

  test('changes the video key when the sampling changes', () => {
    const base = { maxMinutes: 20, frameIntervalSeconds: 20, maxFrames: 24, maxHeight: 360 }
    expect(videoCacheKey('abc123', base)).toBe(videoCacheKey('abc123', base))
    expect(videoCacheKey('abc123', { ...base, maxFrames: 12 })).not.toBe(videoCacheKey('abc123', base))
    expect(videoCacheKey('abc123', { ...base, maxHeight: 720 })).not.toBe(videoCacheKey('abc123', base))
  })
})

describe('SessionCache', () => {
  test('runs the loader once and serves later calls from the cache', async () => {
    const cache = new SessionCache<{ runs: number }>()
    let calls = 0
    const loader = async () => {
      calls += 1
      return { runs: calls }
    }

    const first = await cache.load('repo:a/b', loader)
    const second = await cache.load('repo:a/b', loader)

    expect(calls).toBe(1)
    expect(first.hit).toBe(false)
    expect(second.hit).toBe(true)
    expect(second.value).toEqual({ runs: 1 })
    expect(cache.stats()).toMatchObject({ entries: 1, hits: 1, misses: 1 })
  })

  test('hands out clones so a caller cannot mutate the cached artifact', async () => {
    const cache = new SessionCache<{ files: string[] }>()
    const first = await cache.load('repo:a/b', async () => ({ files: ['a.ts'] }))
    first.value.files.push('b.ts')

    const second = await cache.load('repo:a/b', async () => ({ files: [] }))
    expect(second.value.files).toEqual(['a.ts'])
  })

  test('shares one download between concurrent callers', async () => {
    const cache = new SessionCache<{ value: number }>()
    let calls = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const loader = async () => {
      calls += 1
      await gate
      return { value: 7 }
    }

    const first = cache.load('video:x', loader)
    const second = cache.load('video:x', loader)
    release?.()
    const [left, right] = await Promise.all([first, second])

    expect(calls).toBe(1)
    expect(left.value).toEqual({ value: 7 })
    expect(right.value).toEqual({ value: 7 })
    expect([left.hit, right.hit].sort()).toEqual([false, true])
  })

  test('does not cache a failed download', async () => {
    const cache = new SessionCache<string>()
    let calls = 0
    const failing = async () => {
      calls += 1
      throw new Error('rate limited')
    }

    await expect(cache.load('repo:a/b', failing)).rejects.toThrow('rate limited')
    await expect(cache.load('repo:a/b', failing)).rejects.toThrow('rate limited')

    expect(calls).toBe(2)
    expect(cache.size).toBe(0)
  })

  test('evicts the least recently used entry above the entry cap', async () => {
    const cache = new SessionCache<number>({ maxEntries: 2 })
    await cache.load('a', async () => 1)
    await cache.load('b', async () => 2)
    await cache.load('a', async () => 99)
    await cache.load('c', async () => 3)

    let reloaded = false
    await cache.load('b', async () => {
      reloaded = true
      return 4
    })

    expect(reloaded).toBe(true)
    expect(cache.size).toBe(2)
  })

  test('evicts on the byte budget and keeps the newest entry', async () => {
    const cache = new SessionCache<string>({ maxBytes: 10 })
    const weigh = (value: string) => value.length
    await cache.load('a', async () => 'x'.repeat(8), weigh)
    await cache.load('b', async () => 'y'.repeat(8), weigh)

    expect(cache.size).toBe(1)
    let hits = 0
    const cached = await cache.load('b', async () => {
      hits += 1
      return 'miss'
    })
    expect(hits).toBe(0)
    expect(cached.hit).toBe(true)
  })
})
