import { describe, expect, test } from 'bun:test'
import { sanitiseAgentAnswer } from './offline-agent'

const input = {
  projects: [
    { id: 'alpha', name: 'Alpha' },
    { id: 'beta', name: 'Beta' },
  ],
  repositories: ['repos/alpha', 'repos/beta'],
  videos: ['videos/alpha.mp4', 'videos/beta.mp4'],
  suggestions: [] as Array<{ project: string; repository: string; video: string }>,
}

describe('sanitiseAgentAnswer', () => {
  test('keeps a valid repository and video', () => {
    const mapping = sanitiseAgentAnswer({
      ...input,
      suggestions: [{ project: 'alpha', repository: 'repos/alpha', video: 'videos/alpha.mp4' }],
    })
    expect(mapping).toEqual({ alpha: { repository: 'repos/alpha', video: 'videos/alpha.mp4' } })
  })

  test('drops unknown projects and hallucinated paths', () => {
    const mapping = sanitiseAgentAnswer({
      ...input,
      suggestions: [
        { project: 'gamma', repository: 'repos/alpha', video: '' },
        { project: 'beta', repository: 'repos/does-not-exist', video: 'videos/beta.mp4' },
      ],
    })
    expect(mapping).toEqual({ beta: { video: 'videos/beta.mp4' } })
  })

  test('never lets one path feed two projects', () => {
    const mapping = sanitiseAgentAnswer({
      ...input,
      suggestions: [
        { project: 'alpha', repository: 'repos/alpha', video: '' },
        { project: 'beta', repository: 'repos/alpha', video: '' },
      ],
    })
    expect(mapping.alpha?.repository).toBe('repos/alpha')
    expect(mapping.beta).toBeUndefined()
  })

  test('keeps a seed half the agent left out and merges the other half', () => {
    const mapping = sanitiseAgentAnswer({
      ...input,
      seed: { alpha: { video: 'videos/alpha.mp4' } },
      suggestions: [{ project: 'alpha', repository: 'repos/alpha', video: '' }],
    })
    expect(mapping.alpha).toEqual({ repository: 'repos/alpha', video: 'videos/alpha.mp4' })
  })

  test('removes a seed the agent judged wrong', () => {
    const mapping = sanitiseAgentAnswer({
      ...input,
      seed: { alpha: { repository: 'repos/beta' } },
      suggestions: [],
      drop: ['alpha'],
    })
    expect(mapping.alpha).toBeUndefined()
  })
})
