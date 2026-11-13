import { describe, expect, test } from 'bun:test'
import { RAIL_DEFAULT_HEIGHT, RAIL_MAX_HEIGHT, RAIL_MIN_HEIGHT, clampRailHeight } from './arena-layout'

describe('clampRailHeight', () => {
  test('keeps a normal drag inside the band', () => {
    expect(clampRailHeight(260, 900)).toBe(260)
  })

  test('clamps under the floor and over the ceiling', () => {
    expect(clampRailHeight(20, 900)).toBe(RAIL_MIN_HEIGHT)
    expect(clampRailHeight(9_000, 900)).toBe(RAIL_MAX_HEIGHT)
  })

  test('caps at 60% of a short viewport', () => {
    expect(clampRailHeight(400, 480)).toBe(288)
  })

  test('falls back to the default for a corrupt stored value', () => {
    expect(clampRailHeight(Number.NaN, 900)).toBe(RAIL_DEFAULT_HEIGHT)
  })
})
