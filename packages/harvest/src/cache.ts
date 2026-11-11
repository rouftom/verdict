/**
 * Session cache for harvested sources.
 *
 * The evaluation API is long lived, and the same project is often re-run with
 * a different rubric or a different model set. Downloading the same tarball or
 * the same video again wastes bandwidth and minutes of transcription, so a
 * successful harvest is reused for the rest of the process lifetime. Nothing
 * is written to disk: closing the app (restarting the API) empties the cache.
 */

export interface SessionCacheOptions {
  /** Maximum number of artifacts kept at once. */
  maxEntries?: number
  /** Approximate byte budget; entries are evicted oldest first above it. */
  maxBytes?: number
}

export interface CacheLoad<T> {
  value: T
  /** True when the loader was skipped and the value came from the cache. */
  hit: boolean
}

export interface SessionCacheStats {
  entries: number
  bytes: number
  hits: number
  misses: number
}

interface Entry<T> {
  value: T
  bytes: number
}

const DEFAULT_MAX_ENTRIES = 24
const DEFAULT_MAX_BYTES = 96 * 1024 * 1024

export class SessionCache<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly inflight = new Map<string, Promise<T>>()
  private readonly maxEntries: number
  private readonly maxBytes: number
  private bytes = 0
  private hits = 0
  private misses = 0

  constructor(options: SessionCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES)
    this.maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_MAX_BYTES)
  }

  get size(): number {
    return this.entries.size
  }

  stats(): SessionCacheStats {
    return { entries: this.entries.size, bytes: this.bytes, hits: this.hits, misses: this.misses }
  }

  /** Return a clone, so a caller cannot mutate the cached artifact. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    // Refresh recency: Map keeps insertion order, so re-inserting moves the
    // entry to the end and makes the first key the least recently used.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return structuredClone(entry.value)
  }

  set(key: string, value: T, weigh?: (value: T) => number): void {
    const bytes = Math.max(0, Math.round(weigh ? weigh(value) : 0))
    const previous = this.entries.get(key)
    if (previous) {
      this.entries.delete(key)
      this.bytes -= previous.bytes
    }
    this.entries.set(key, { value, bytes })
    this.bytes += bytes
    this.evict()
  }

  /**
   * Return the cached artifact or run the loader once. Concurrent callers for
   * the same key share a single download instead of racing each other.
   */
  async load(key: string, loader: () => Promise<T>, weigh?: (value: T) => number): Promise<CacheLoad<T>> {
    const cached = this.get(key)
    if (cached !== undefined) {
      this.hits += 1
      return { value: cached, hit: true }
    }

    const running = this.inflight.get(key)
    if (running) {
      this.hits += 1
      return { value: structuredClone(await running), hit: true }
    }

    this.misses += 1
    const promise = loader()
    this.inflight.set(key, promise)
    try {
      const value = await promise
      // Only successes are cached: a rate limit or a removed video must be
      // retried on the next run, not replayed forever.
      this.set(key, value, weigh)
      return { value: structuredClone(value), hit: false }
    } finally {
      this.inflight.delete(key)
    }
  }

  clear(): void {
    this.entries.clear()
    this.inflight.clear()
    this.bytes = 0
    this.hits = 0
    this.misses = 0
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries || (this.bytes > this.maxBytes && this.entries.size > 1)) {
      const oldest = this.entries.keys().next()
      if (oldest.done) return
      const entry = this.entries.get(oldest.value)
      this.entries.delete(oldest.value)
      if (entry) this.bytes -= entry.bytes
    }
  }
}

/** Repository identity ignores the URL form, `.git` and letter case. */
export function repoCacheKey(owner: string, repo: string, maxBytes: number): string {
  return `v1:repo:${owner.toLowerCase()}/${repo.toLowerCase()}:${maxBytes}`
}

export interface VideoCacheKeyOptions {
  maxMinutes: number
  frameIntervalSeconds: number
  maxFrames: number
  maxHeight: number
}

/**
 * A video harvest depends on the transcript and the frame sampling, so the key
 * carries the options that change the artifact. A session that asks for more
 * frames must download again rather than silently reuse a thinner harvest.
 */
export function videoCacheKey(id: string, options: VideoCacheKeyOptions): string {
  const { maxMinutes, frameIntervalSeconds, maxFrames, maxHeight } = options
  return `v1:video:${id}:${maxMinutes}:${frameIntervalSeconds}:${maxFrames}:${maxHeight}`
}

/**
 * Every cache created during the process, so a shutdown hook or a test can
 * empty the whole session at once.
 */
const registry = new Set<SessionCache<unknown>>()

export function createSessionCache<T>(options: SessionCacheOptions = {}): SessionCache<T> {
  const cache = new SessionCache<T>(options)
  registry.add(cache as SessionCache<unknown>)
  return cache
}

/** Empty every session cache, used by tests and by a shutdown hook. */
export function clearSessionCaches(): void {
  for (const cache of registry) cache.clear()
}
