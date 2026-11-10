import { describe, expect, test } from 'bun:test'
import { REASONING_EFFORTS, REASONING_EFFORT_LABELS } from './reasoning'
import { runOptionsSchema } from './schemas'

describe('reasoning effort', () => {
  test('every effort has a label', () => {
    expect(REASONING_EFFORTS.length).toBe(7)
    for (const effort of REASONING_EFFORTS) expect(REASONING_EFFORT_LABELS[effort]).toBeTruthy()
  })

  test('run options keep a per-agent effort', () => {
    const options = runOptionsSchema.parse({
      evaluatorModels: [
        { provider: 'anthropic', model: 'claude-sonnet-5-5', reasoningEffort: 'high' },
        { provider: 'runware', model: 'deepseek:v4.1@flash-1017' },
      ],
      verifierModels: [{ provider: 'google', model: 'gemini-3.5-flash', reasoningEffort: 'none' }],
    })
    expect(options.evaluatorModels[0]?.reasoningEffort).toBe('high')
    expect(options.evaluatorModels[1]?.reasoningEffort).toBeUndefined()
    expect(options.verifierModels[0]?.reasoningEffort).toBe('none')
  })

  test('an unknown effort is rejected', () => {
    const parsed = runOptionsSchema.safeParse({
      evaluatorModels: [{ provider: 'anthropic', model: 'claude-sonnet-5-5', reasoningEffort: 'turbo' }],
    })
    expect(parsed.success).toBe(false)
  })
})
