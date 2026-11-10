import type { Rubric } from './types'

/**
 * Neutral four-criterion rubric, modelled on the public hackathon rubric but
 * with no organiser or vendor name. It is the default when the operator uploads
 * no rubric; any rubric can be loaded instead.
 */
export const DEFAULT_RUBRIC: Rubric = {
  version: 1,
  name: 'Project evaluation (generic rubric)',
  description:
    'Four weighted criteria: impact, use of AI tooling, technical depth and demo. Upload another rubric to replace it.',
  scale: {
    min: 0,
    max: 100,
    step: 1,
    anchors: [
      { range: [0, 19], label: 'Absent', hint: 'No credible evidence, or contradicted by the artefacts.' },
      { range: [20, 39], label: 'Weak', hint: 'Mentioned but shallow, generic, or only partly working.' },
      { range: [40, 59], label: 'Adequate', hint: 'Present and functional, but conventional.' },
      { range: [60, 79], label: 'Strong', hint: 'Thoughtful, well executed, clearly evidenced.' },
      { range: [80, 100], label: 'Exceptional', hint: 'Distinctive, surprising, production-grade or novel.' },
    ],
  },
  criteria: [
    {
      id: 'impact',
      label: 'Impact (30%)',
      weight: 0.3,
      description:
        "What's the real-world potential here? Who benefits, and how much does it matter? Could this actually become something people use? Does it fit into one of the problem statements listed above?",
      questions: [
        'Who is the user, and what concrete problem is solved for them?',
        'Is the benefit measurable, or only asserted?',
        'Is the scope credible for the time available?',
        'Does the project fit one of the published problem statements?',
      ],
      evidence: ['repository', 'demo_video', 'transcript'],
      signals: ['Clear target user and pain point', 'Demonstrated workflow', 'Credible path to real usage'],
      redFlags: ['Generic idea with no specific beneficiary', 'Impact claimed only in the README'],
    },
    {
      id: 'ai_tooling',
      label: 'Use of AI Tooling (25%)',
      weight: 0.25,
      description:
        'How creatively did this team use AI tooling? Did they go beyond a basic integration? Did they surface capabilities that were unexpected or genuinely inventive?',
      questions: [
        'Which models or AI capabilities are used at runtime?',
        'Is the integration meaningful, or a thin wrapper around a chat call?',
        'Are model-specific strengths used deliberately?',
        'Is there evidence of iteration or inventive use?',
      ],
      evidence: ['repository', 'demo_video', 'transcript'],
      signals: ['Model choice justified by the task', 'Multiple capabilities combined coherently', 'Non-obvious use'],
      redFlags: ['AI mentioned in the pitch but absent from the code', 'Single generic prompt with no product'],
    },
    {
      id: 'technical_depth',
      label: 'Technical Depth & Execution (20%)',
      weight: 0.2,
      description:
        'Is the engineering sound and thoughtfully refined? Does this feel like something that was thought through with real craft.',
      questions: [
        'Is the architecture coherent and the code readable?',
        'Are failure modes, limits and edge cases handled?',
        'Is there evidence of testing, typing, observability or operational care?',
        'Is the work original and built during the event?',
      ],
      evidence: ['repository', 'commit_history', 'demo_video'],
      signals: ['Clear separation of concerns', 'Tests, validation, error handling', 'Dependencies managed deliberately'],
      redFlags: ['No error handling, no tests, hard-coded secrets', 'Repository does not build or does not match the demo'],
    },
    {
      id: 'demo',
      label: 'Demo (25%)',
      weight: 0.25,
      description:
        'Is this a working, impressive demo? Does the product hold up live? Is the demo video genuinely cool to watch?',
      questions: [
        'Does the demo show the product actually working end to end?',
        'Is the video clear, credible and well paced?',
        'Does the shown behaviour match the repository?',
        'Would the product hold up under live questions?',
      ],
      evidence: ['demo_video', 'transcript', 'keyframes', 'repository'],
      signals: ['Real interaction, not only slides', 'Clear narrative and visible output', 'Claims consistent with the code'],
      redFlags: ['Mocked results presented as live', 'Missing key functionality', 'Demo impossible to reproduce'],
    },
  ],
  ranking: {
    scope: 'track',
    primary: 'weighted_score',
    comparativePass: true,
    tieBreakers: ['impact', 'demo', 'technical_depth'],
    providedRanks: { useInScores: false, compareAfter: true },
    anchors: { source: 'user_selection', max: 3 },
  },
  consensus: {
    evaluators: 6,
    verifiers: 2,
    maxRounds: 2,
    tolerancePoints: 8,
    aggregation: 'trimmed_mean',
    requireEvidence: true,
    minEvidencePerCriterion: 1,
    verifierAdjustmentLimit: 10,
    onUnresolved: 'escalate',
  },
  rules: [
    { id: 'new_work', label: 'Built during the event', severity: 'disqualify', check: 'Commit history and demo show work produced during the event window.' },
    { id: 'public_repo', label: 'Public repository', severity: 'disqualify', check: 'The repository is publicly accessible.' },
    { id: 'demo_video', label: 'Required demo video', severity: 'disqualify', check: 'A demo video of about three minutes is present.' },
    { id: 'one_track', label: 'Single track', severity: 'disqualify', check: 'The project is entered in exactly one track.' },
    { id: 'rights', label: 'Rights to code, data and assets', severity: 'disqualify', check: 'No unlicensed code, data or assets.' },
  ],
}
