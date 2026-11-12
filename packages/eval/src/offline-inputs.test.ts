import { describe, expect, test } from 'bun:test'
import { detectOfflineInputs, detectOfflineInputsHeuristic } from './offline-inputs'

const MANIFEST = `projects:
  - name: Alpha
    github: https://github.com/acme/alpha
    track: agents
  - name: Beta
    video: https://youtu.be/abcdefghijk
    track: agents
`

const RULES = `# Event rules

Projects must be open source and submitted before Friday.
Every submission should include a demo video.
Eligibility is limited to registered teams.
`

const RUBRIC = `name: Hackathon rubric
criteria:
  - id: impact
    label: Impact
    weight: 0.5
    description: Real-world usefulness
  - id: craft
    label: Craft
    weight: 0.5
    description: Quality of the build
`

describe('detectOfflineInputsHeuristic', () => {
  test('finds the manifest, the rules and the rubric by content', () => {
    const detection = detectOfflineInputsHeuristic([
      { path: 'bundle/data/projects.yaml', text: MANIFEST },
      { path: 'bundle/docs/rules.md', text: RULES },
      { path: 'bundle/data/scoring.yaml', text: RUBRIC },
      { path: 'bundle/src/index.ts', text: 'export const answer = 42' },
    ])
    expect(detection.manifest?.filename).toBe('bundle/data/projects.yaml')
    expect(detection.rules?.filename).toBe('bundle/docs/rules.md')
    expect(detection.rubric?.filename).toBe('bundle/data/scoring.yaml')
    expect(detection.method).toBe('heuristic')
  })

  test('never treats an empty or criteria-free file as a rubric', () => {
    const detection = detectOfflineInputsHeuristic([
      { path: 'rubric.yaml', text: 'name: empty\n' },
      { path: 'notes.txt', text: '' },
    ])
    expect(detection.rubric).toBeUndefined()
  })

  test('does not reuse the manifest as the rules', () => {
    const detection = detectOfflineInputsHeuristic([{ path: 'projects.json', text: JSON.stringify([{ name: 'A', github: 'https://github.com/a/b' }]) }])
    expect(detection.manifest?.filename).toBe('projects.json')
    expect(detection.rules).toBeUndefined()
  })
})

describe('detectOfflineInputs', () => {
  test('returns partial detection and a warning when no model is configured', async () => {
    const detection = await detectOfflineInputs([{ path: 'projects.yaml', text: MANIFEST }])
    expect(detection.manifest?.filename).toBe('projects.yaml')
    expect(detection.method).toBe('partial')
    expect(detection.warnings.join(' ')).toContain('No model is configured')
  })

  test('warns that Evaluate stays blocked when no manifest was found', async () => {
    const detection = await detectOfflineInputs([{ path: 'rules.md', text: RULES }])
    expect(detection.manifest).toBeUndefined()
    expect(detection.warnings.join(' ')).toContain('No project manifest was found')
  })
})
