/** Shared domain types for the evaluator. No runtime code, no secrets. */

export type ProviderId =
  | 'meta'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'runware'
  | 'groq'
  | 'deepseek'
  | 'nebius'
  | 'nvidia'
  | 'ollama'

export interface ModelCapabilities {
  text: boolean
  vision: boolean
  video: boolean
  tools: boolean
  audio: boolean
}

export interface ModelOption {
  id: string
  label: string
  provider: ProviderId
  capabilities: ModelCapabilities
}

export interface ProviderInfo {
  id: ProviderId
  label: string
  configured: boolean
  baseURL?: string
  models: ModelOption[]
}

/**
 * Provider-neutral reasoning effort. Each provider maps it to its own knob:
 * Anthropic `effort`/thinking budget, Google `thinkingLevel`/`thinkingBudget`,
 * OpenAI, xAI and OpenAI-compatible gateways `reasoning_effort`.
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Public (non-secret) description of an evaluator or verifier persona. */
export interface AgentInfo {
  id: string
  name: string
  lens: string
  focus: string
  evidenceHint: string
}

export interface AgentPool {
  evaluators: AgentInfo[]
  verifiers: AgentInfo[]
}

export interface ModelRef {
  provider: ProviderId
  model: string
  /**
   * Per-agent override. Left unset, the provider falls back to
   * `REASONING_EFFORT_<PROVIDER>` then `REASONING_EFFORT`.
   */
  reasoningEffort?: ReasoningEffort
}

/** A project as read from the uploaded manifest. */
export interface ProjectInput {
  id: string
  name: string
  rank?: number
  /** Primary track, always the first entry of `tracks`. */
  track?: string
  /** Every track the project is entered in, primary track first. */
  tracks?: string[]
  github?: string
  youtube?: string
  description?: string
  team?: string[]
  extra?: Record<string, unknown>
}

export interface ManifestParseResult {
  projects: ProjectInput[]
  warnings: string[]
}

export interface RubricAnchor {
  range: [number, number]
  label: string
  hint?: string
}

export interface RubricScale {
  min: number
  max: number
  step: number
  anchors: RubricAnchor[]
}

export interface RubricCriterion {
  id: string
  label: string
  weight: number
  description: string
  questions: string[]
  evidence: string[]
  signals: string[]
  redFlags: string[]
}

export interface RubricRanking {
  scope: 'track' | 'global'
  primary: 'weighted_score'
  comparativePass: boolean
  tieBreakers: string[]
  providedRanks: {
    useInScores: boolean
    compareAfter: boolean
  }
  anchors: {
    source: 'user_selection'
    max: number
  }
}

export interface RubricConsensus {
  evaluators: number
  verifiers: number
  maxRounds: number
  tolerancePoints: number
  aggregation: 'trimmed_mean' | 'mean' | 'median'
  requireEvidence: boolean
  minEvidencePerCriterion: number
  verifierAdjustmentLimit: number
  onUnresolved: 'escalate' | 'average'
}

export interface RubricRule {
  id: string
  label: string
  severity: 'disqualify' | 'warn'
  check: string
}

export interface Rubric {
  version: number
  name: string
  description: string
  scale: RubricScale
  criteria: RubricCriterion[]
  ranking: RubricRanking
  consensus: RubricConsensus
  rules: RubricRule[]
}

export interface FileEntry {
  path: string
  size: number
  ext: string
}

export interface CommitInfo {
  sha?: string
  message: string
  date?: string
  author?: string
}

export interface RepoArtifact {
  url: string
  owner: string
  repo: string
  defaultBranch?: string
  description?: string
  license?: string
  stars?: number
  files: FileEntry[]
  tree: string
  readme: string
  keyFiles: Array<{ path: string; content: string }>
  filesCount: number
  loc: number
  languages: Record<string, number>
  commits: CommitInfo[]
  firstCommitAt?: string
  lastCommitAt?: string
  fetchedAt: string
}

export interface TranscriptSegment {
  index: number
  start: number
  end: number
  text: string
}

export interface TranscriptArtifact {
  text: string
  segments: TranscriptSegment[]
  model?: string
  language?: string
}

export interface FrameEvidence {
  index: number
  atSeconds: number
  path: string
  caption?: string
}

export interface VideoArtifact {
  url: string
  title?: string
  duration?: number
  uploader?: string
  thumbnail?: string
  transcript?: TranscriptArtifact
  frames: FrameEvidence[]
  fetchedAt: string
}

export interface ProjectEvidence {
  projectId: string
  repo?: RepoArtifact
  video?: VideoArtifact
  errors: string[]
}

export interface CriterionScore {
  criterionId: string
  score: number
  confidence: number
  evidence: string[]
  rationale: string
  redFlags: string[]
}

export interface ProjectEvaluation {
  projectId: string
  agentId: string
  agentName: string
  model: string
  scores: CriterionScore[]
  overall: number
  summary: string
  redFlags: string[]
}

export interface ProjectRevision extends ProjectEvaluation {
  round: number
  changed: boolean
  changeReason?: string
}

export interface ConsensusCriterion {
  criterionId: string
  score: number
  spread: number
  scores: number[]
  notes: string[]
}

export interface ProjectConsensus {
  projectId: string
  criteria: ConsensusCriterion[]
  overall: number
  dispersion: number
  confidence: number
  status: 'consensus' | 'escalated'
  disagreements: string[]
}

export interface VerificationAdjustment {
  criterionId: string
  from: number
  to: number
  reason: string
}

export interface ProjectVerification {
  projectId: string
  verifierId: string
  verifierName: string
  model: string
  finalScores: Record<string, number>
  finalOverall: number
  adjustments: VerificationAdjustment[]
  approved: boolean
  notes: string
  redFlags: string[]
}

export interface RankedProject {
  projectId: string
  name: string
  track: string
  rank: number
  overall: number
  providedRank?: number
  rankDelta?: number
  confidence: number
  status: ProjectConsensus['status']
}

export interface TrackRanking {
  track: string
  entries: RankedProject[]
}

export interface Report {
  runId: string
  createdAt: string
  rubricName: string
  models: {
    evaluators: string[]
    verifiers: string[]
  }
  criteria: Array<{ id: string; label: string; weight: number }>
  rankings: TrackRanking[]
  projects: Array<{
    projectId: string
    name: string
    track: string
    consensus: ProjectConsensus
    verifications: ProjectVerification[]
    finalScores: Record<string, number>
    finalOverall: number
    evidence: {
      repoFiles: number
      transcriptSegments: number
      frames: number
      errors: string[]
    }
  }>
  warnings: string[]
}

export type RunStatus =
  | 'queued'
  | 'parsing'
  | 'harvesting'
  | 'evaluating'
  | 'reviewing'
  | 'consensus'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface RunOptions {
  evaluatorModels: ModelRef[]
  verifierModels: ModelRef[]
  showRanksToAgents: boolean
  anchors: string[]
  maxRounds: number
  temperature: number
  concurrency: number
  maxVideoMinutes: number
  frameIntervalSeconds: number
}

export type RunEventType =
  | 'stage'
  | 'log'
  | 'project'
  | 'evidence'
  | 'evaluation'
  | 'revision'
  | 'consensus'
  | 'verification'
  | 'report'
  | 'error'

export interface RunEvent {
  type: RunEventType
  runId: string
  at: string
  message?: string
  projectId?: string
  data?: unknown
}

export interface RunSnapshot {
  id: string
  createdAt: string
  updatedAt: string
  status: RunStatus
  options: RunOptions
  rules: string
  manifest: ProjectInput[]
  rubric: Rubric
  evidence: ProjectEvidence[]
  evaluations: ProjectEvaluation[]
  revisions: ProjectRevision[]
  consensus: ProjectConsensus[]
  verifications: ProjectVerification[]
  report?: Report
  events: RunEvent[]
  warnings: string[]
  error?: string
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  calls: number
}
