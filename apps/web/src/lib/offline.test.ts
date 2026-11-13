import { describe, expect, test } from 'bun:test'
import type { OfflineMapping } from '@verdict/shared'
import { applyAgentMapping, formatBytes, sourceLabel, usedByOthers, withMatch } from './offline'

describe('withMatch', () => {
  test('adds a source and clears the other half when set back to none', () => {
    const mapped = withMatch({}, 'alpha', 'repository', 'repos/alpha')
    expect(mapped).toEqual({ alpha: { repository: 'repos/alpha' } })
    expect(withMatch(mapped, 'alpha', 'repository', '')).toEqual({})
  })

  test('a path moves to the project that just picked it', () => {
    const mapped = withMatch({ alpha: { repository: 'repos/shared' } }, 'beta', 'repository', 'repos/shared')
    expect(mapped).toEqual({ beta: { repository: 'repos/shared' } })
  })

  test('keeps the untouched half of the same project', () => {
    const mapped = withMatch({ alpha: { video: 'videos/alpha.mp4' } }, 'alpha', 'repository', 'repos/alpha')
    expect(mapped.alpha).toEqual({ repository: 'repos/alpha', video: 'videos/alpha.mp4' })
  })
})

describe('applyAgentMapping', () => {
  test('a hand-picked half wins over the agent', () => {
    const manual: OfflineMapping = { alpha: { repository: 'repos/manual' } }
    const agent: OfflineMapping = { alpha: { repository: 'repos/agent', video: 'videos/alpha.mp4' } }
    expect(applyAgentMapping(agent, manual).alpha).toEqual({
      repository: 'repos/manual',
      video: 'videos/alpha.mp4',
    })
  })

  test('the agent never gives a hand-picked path to a second project', () => {
    const manual: OfflineMapping = { alpha: { repository: 'repos/manual' } }
    const agent: OfflineMapping = {
      alpha: { repository: 'repos/manual' },
      beta: { repository: 'repos/manual' },
    }
    expect(applyAgentMapping(agent, manual)).toEqual({ alpha: { repository: 'repos/manual' } })
  })
})

describe('offline labels', () => {
  test('formatBytes keeps a readable unit', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB')
  })

  test('sourceLabel keeps the last path segment', () => {
    expect(sourceLabel('repos/alpha')).toBe('alpha')
    expect(sourceLabel(undefined)).toBe('')
  })

  test('usedByOthers ignores the current project', () => {
    const mapping: OfflineMapping = {
      alpha: { repository: 'repos/alpha', video: 'videos/alpha.mp4' },
      beta: { repository: 'repos/beta' },
    }
    expect([...usedByOthers(mapping, 'alpha', 'repository')]).toEqual(['repos/beta'])
    expect([...usedByOthers(mapping, 'alpha', 'video')]).toEqual([])
  })
})
