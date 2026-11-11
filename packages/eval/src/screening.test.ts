import { describe, expect, test } from 'bun:test'
import { failOpenStageOne, stageOneFromOutput } from './screening'

describe('stageOneFromOutput', () => {
  test('passes only when theme fit and tooling use both hold', () => {
    expect(stageOneFromOutput('p', { themeFit: true, toolingUse: true, rationale: '' }).passed).toBe(true)
    expect(stageOneFromOutput('p', { themeFit: true, toolingUse: false, rationale: '' }).passed).toBe(false)
    expect(stageOneFromOutput('p', { themeFit: false, toolingUse: true, rationale: '' }).passed).toBe(false)
    expect(stageOneFromOutput('p', { themeFit: false, toolingUse: false, rationale: '' }).passed).toBe(false)
  })

  test('names the check that failed when the model gives no reason', () => {
    const failed = stageOneFromOutput('p', { themeFit: true, toolingUse: false, rationale: '' })
    expect(failed.rationale).toContain('runtime use')
    expect(stageOneFromOutput('p', { themeFit: false, toolingUse: true, rationale: '' }).rationale).toContain('does not clearly fit')
  })

  test('keeps the model rationale when there is one', () => {
    const result = stageOneFromOutput('p', {
      themeFit: true,
      toolingUse: true,
      rationale: 'repo:src/agent.ts calls the model at runtime.',
    })
    expect(result.rationale).toBe('repo:src/agent.ts calls the model at runtime.')
  })
})

describe('failOpenStageOne', () => {
  test('advances the project and says the gate did not run', () => {
    const result = failOpenStageOne('p', 'JSON parse error')
    expect(result.passed).toBe(true)
    expect(result.rationale).toContain('JSON parse error')
    expect(result.rationale).toContain('manual review')
  })
})
