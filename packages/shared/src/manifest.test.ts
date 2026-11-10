import { describe, expect, test } from 'bun:test'
import { DEFAULT_RUBRIC } from './default-rubric'
import { parseManifestText } from './manifest'
import { rankProjects } from './consensus'
import type { ProjectConsensus } from './types'

function consensus(projectId: string, overall: number): ProjectConsensus {
  return {
    projectId,
    criteria: [],
    overall,
    dispersion: 0,
    confidence: 0.8,
    status: 'consensus',
    disagreements: [],
  }
}

describe('multi-track manifests', () => {
  test('keeps every track and treats the first as the primary one', () => {
    const { projects, warnings } = parseManifestText(
      JSON.stringify([
        {
          name: 'Consai',
          rank: 1,
          github: 'https://github.com/lucianobogo/punchwalk',
          tracks: ['startup', 'Best creative build', 'Best build on Open Weights'],
        },
      ]),
    )

    expect(projects[0]?.track).toBe('startup')
    expect(projects[0]?.tracks).toEqual(['startup', 'Best creative build', 'Best build on Open Weights'])
    expect(projects[0]?.rank).toBe(1)
    expect(warnings.some((warning) => warning.includes('applies to the primary track'))).toBe(true)
  })

  test('keeps the legacy track field working and dedupes primary plus tracks', () => {
    const { projects } = parseManifestText(
      JSON.stringify([
        { name: 'Legacy', track: 'indie', github: 'https://github.com/a/legacy' },
        { name: 'Mixed', track: 'indie', tracks: ['indie', 'Best agentic use case'], github: 'https://github.com/a/mixed' },
      ]),
    )

    expect(projects[0]?.track).toBe('indie')
    expect(projects[0]?.tracks).toEqual(['indie'])
    expect(projects[1]?.tracks).toEqual(['indie', 'Best agentic use case'])
  })

  test('ranks a project in every track it enters, with the provided rank only in its primary track', () => {
    const { projects } = parseManifestText(
      JSON.stringify([
        { name: 'A', rank: 2, tracks: ['startup', 'Best creative build'], github: 'https://github.com/a/a' },
        { name: 'B', rank: 1, tracks: ['startup'], github: 'https://github.com/a/b' },
        { name: 'C', rank: 7, tracks: ['Best creative build'], github: 'https://github.com/a/c' },
      ]),
    )
    const rankings = rankProjects(
      projects,
      [consensus(projects[0]!.id, 80), consensus(projects[1]!.id, 90), consensus(projects[2]!.id, 70)],
      DEFAULT_RUBRIC,
    )

    const startup = rankings.find((ranking) => ranking.track === 'startup')
    const creative = rankings.find((ranking) => ranking.track === 'Best creative build')

    expect(startup?.entries.map((entry) => entry.name)).toEqual(['B', 'A'])
    expect(creative?.entries.map((entry) => entry.name)).toEqual(['A', 'C'])

    const aInStartup = startup?.entries.find((entry) => entry.name === 'A')
    const aInCreative = creative?.entries.find((entry) => entry.name === 'A')
    expect(aInStartup?.providedRank).toBe(2)
    expect(aInCreative?.providedRank).toBeUndefined()
  })
})
