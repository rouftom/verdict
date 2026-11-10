export interface AgentDefinition {
  id: string
  name: string
  lens: string
  focus: string
  evidenceHint: string
}

/** Six evaluators. Each scores every rubric criterion; the lens only changes what they scrutinise first. */
export const EVALUATORS: AgentDefinition[] = [
  {
    id: 'e1',
    name: 'Impact & problem fit',
    lens: 'Impact',
    focus: 'Who benefits, how much it matters, and whether the project fits a published problem statement.',
    evidenceHint: 'README, problem statement, demonstrated user workflow, transcript claims.',
  },
  {
    id: 'e2',
    name: 'AI tooling',
    lens: 'Use of AI tooling',
    focus: 'Which models are actually used at runtime, how deliberately they are chosen, and whether the integration goes beyond a thin wrapper.',
    evidenceHint: 'Dependency manifests, model calls, prompts, tool use, keyframes showing model output.',
  },
  {
    id: 'e3',
    name: 'Technical depth',
    lens: 'Technical Depth & Execution',
    focus: 'Architecture, code quality, error handling, tests, build story and evidence of real craft.',
    evidenceHint: 'File tree, key files, dependency manifests, commits, configuration.',
  },
  {
    id: 'e4',
    name: 'Demo & video',
    lens: 'Demo',
    focus: 'Whether the demo shows the product working end to end, whether the video is credible and well paced, and whether it matches the repository.',
    evidenceHint: 'Transcript with timestamps, keyframe list, consistency with the code.',
  },
  {
    id: 'e5',
    name: 'Evidence & rules',
    lens: 'Cross-cutting integrity',
    focus: 'Whether claims are supported by artefacts, whether the work is new, and whether hard rules are met.',
    evidenceHint: 'Commit dates, licence, claims versus code, disqualifiers.',
  },
  {
    id: 'e6',
    name: 'Cross-cutting chair',
    lens: 'Whole-project coherence',
    focus: 'Whole-project coherence, contradictions between sources, and gaps the specialist lenses may miss.',
    evidenceHint: 'All artefacts, especially mismatches between repository and demo.',
  },
]

/** Two verifiers. They audit the six evaluations, never replace them. */
export const VERIFIERS: AgentDefinition[] = [
  {
    id: 'v1',
    name: 'Rubric & scoring verifier',
    lens: 'Rubric compliance',
    focus: 'Weights, scale, evidence per criterion, arithmetic, and consistency between criterion scores and the overall.',
    evidenceHint: 'The rubric, every evaluator score, the consensus table.',
  },
  {
    id: 'v2',
    name: 'Evidence & integrity verifier',
    lens: 'Evidence integrity',
    focus: 'Unsupported claims, fabricated citations, anchoring to supplied ranks, disqualifiers and missing evidence.',
    evidenceHint: 'The evidence bundle, every cited path or timestamp, the rules.',
  },
]
