import { describe, expect, test } from 'bun:test'
import { MATURITY_RAMP, maturityColor } from './maturity'

describe('maturity ramp', () => {
  test('one colour per 0–5 class', () => {
    expect(MATURITY_RAMP).toHaveLength(6)
    expect(new Set(MATURITY_RAMP).size).toBe(6)
  })

  test('clamps and rounds a score to its class', () => {
    expect(maturityColor(0)).toBe(MATURITY_RAMP[0]!)
    expect(maturityColor(2.6)).toBe(MATURITY_RAMP[3]!)
    expect(maturityColor(-4)).toBe(MATURITY_RAMP[0]!)
    expect(maturityColor(9)).toBe(MATURITY_RAMP[5]!)
  })
})
