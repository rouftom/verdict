import { z } from 'zod'
import { REASONING_EFFORTS } from './reasoning'

export const PROVIDER_IDS = [
  'meta',
  'openai',
  'anthropic',
  'google',
  'xai',
  'runware',
  'groq',
  'deepseek',
  'nebius',
  'nvidia',
  'ollama',
] as const

export const reasoningEffortSchema = z.enum(REASONING_EFFORTS)

export const modelRefSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().min(1),
  reasoningEffort: reasoningEffortSchema.optional(),
})

export const offlineBundleRefSchema = z.object({
  id: z.string().min(1),
  label: z.string().max(255).optional(),
  /** Manual matches: project id to bundle-relative repository and video paths. */
  mapping: z
    .record(
      z.string(),
      z.object({
        repository: z.string().max(1_024).optional(),
        video: z.string().max(1_024).optional(),
      }),
    )
    .optional(),
})

export const runOptionsSchema = z.object({
  evaluatorModels: z.array(modelRefSchema).default([]),
  verifierModels: z.array(modelRefSchema).default([]),
  /** Kept for the operator's audit trail. Ranks never enter scoring prompts. */
  showRanksToAgents: z.boolean().default(false),
  cacheResources: z.boolean().default(true),
  anchors: z.array(z.string()).default([]),
  maxRounds: z.number().int().min(1).max(3).default(2),
  temperature: z.number().min(0).max(1).default(0.2),
  concurrency: z.number().int().min(1).max(8).default(2),
  maxVideoMinutes: z.number().min(1).max(120).default(20),
  frameIntervalSeconds: z.number().min(2).max(120).default(20),
  /** A cached offline bundle: every source comes from it, never the network. */
  offline: offlineBundleRefSchema.optional(),
})

export const runRequestSchema = z.object({
  manifestText: z.string().min(2).max(8 * 1024 * 1024),
  manifestFilename: z.string().default('manifest.json'),
  rulesText: z.string().max(4 * 1024 * 1024).default(''),
  rulesFilename: z.string().default('rules.md'),
  rubricText: z.string().max(2 * 1024 * 1024).optional(),
  rubricFilename: z.string().optional(),
  options: runOptionsSchema.partial().optional(),
})

export const rawProjectSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    project: z.string().optional(),
    rank: z.union([z.number(), z.string()]).optional(),
    track: z.string().optional(),
    tracks: z.union([z.array(z.string()), z.string()]).optional(),
    github: z.string().optional(),
    repo: z.string().optional(),
    repository: z.string().optional(),
    youtube: z.string().optional(),
    video: z.string().optional(),
    demo: z.string().optional(),
    demo_video: z.string().optional(),
    description: z.string().optional(),
    team: z.union([z.array(z.string()), z.string()]).optional(),
  })
  .passthrough()

export const rawManifestSchema = z.union([
  z.array(rawProjectSchema),
  z.object({ projects: z.array(rawProjectSchema) }).passthrough(),
])

export const criterionScoreSchema = z.object({
  criterionId: z.string(),
  // Gateways sometimes quote a number or omit an optional field. Coercing and
  // catching here is safer than rejecting an otherwise usable evaluation.
  score: z.coerce.number(),
  confidence: z.coerce.number().min(0).max(1).catch(0.6),
  evidence: z.array(z.string()).catch([]),
  rationale: z.string().default(''),
  redFlags: z.array(z.string()).catch([]),
})

export const stageOneOutputSchema = z.object({
  /** Whether the project reasonably fits a published track it entered. */
  themeFit: z.boolean(),
  /** Whether the event's AI tooling is actually used at runtime. */
  toolingUse: z.boolean(),
  rationale: z.string().default(''),
})

export const evaluationOutputSchema = z.object({
  scores: z.array(criterionScoreSchema).default([]),
  summary: z.string().default(''),
  redFlags: z.array(z.string()).default([]),
  /** Optional relative order of the project ids seen in the dossier. */
  relativeOrder: z.array(z.string()).default([]),
})

export const revisionOutputSchema = evaluationOutputSchema.extend({
  changed: z.boolean().default(false),
  changeReason: z.string().default(''),
})

export const rankingOutputSchema = z.object({
  order: z.array(z.string()),
  rationale: z.string().default(''),
})

export const verificationOutputSchema = z.object({
  /** Redundant with the run: default it instead of rejecting the whole audit. */
  projectId: z.string().default(''),
  finalScores: z.record(z.string(), z.coerce.number()),
  adjustments: z
    .array(
      z.object({
        criterionId: z.string(),
        from: z.coerce.number(),
        to: z.coerce.number(),
        reason: z.string().default(''),
      }),
    )
    .default([]),
  approved: z.boolean().catch(true),
  notes: z.string().default(''),
  redFlags: z.array(z.string()).default([]),
  /** Final order of the project ids in this track, best first. */
  ranking: z.array(z.string()).default([]),
})

export const arenaModeSchema = z.enum(['duel', 'grid'])

export const arenaModelCountSchema = z.object({
  model: modelRefSchema,
  count: z.number().int().min(1).max(12),
})

export const arenaRequestSchema = z
  .object({
    mode: arenaModeSchema.default('duel'),
    manifestText: z.string().min(2).max(8 * 1024 * 1024),
    manifestFilename: z.string().default('manifest.json'),
    rulesText: z.string().max(4 * 1024 * 1024).default(''),
    rulesFilename: z.string().default('rules.md'),
    candidateIds: z.array(z.string().min(1)).min(2).max(8),
    agents: z.array(arenaModelCountSchema).min(1).max(8),
    temperature: z.number().min(0).max(1).default(0.4),
    /** Cached bundle: the arena reads every source from it, never the network. */
    offline: offlineBundleRefSchema.optional(),
  })
  .superRefine((value, context) => {
    if (new Set(value.candidateIds).size !== value.candidateIds.length) {
      context.addIssue({ code: 'custom', path: ['candidateIds'], message: 'Candidate ids must be unique.' })
    }
    if (value.mode === 'duel' && value.candidateIds.length !== 2) {
      context.addIssue({ code: 'custom', path: ['candidateIds'], message: 'A duel needs exactly two candidates.' })
    }
    const total = value.agents.reduce((sum, row) => sum + row.count, 0)
    if (total > 24) {
      context.addIssue({ code: 'custom', path: ['agents'], message: 'An arena holds at most 24 agents.' })
    }
  })

export const arenaVoteOutputSchema = z.object({
  chosenProjectId: z.string().min(1),
  confidence: z.coerce.number().min(0).max(1).catch(0.6),
  rationale: z.string().default(''),
  rejections: z
    .array(
      z.object({
        projectId: z.string().min(1),
        reason: z.string().default(''),
      }),
    )
    .default([]),
})

export type ArenaVoteOutput = z.infer<typeof arenaVoteOutputSchema>

export type EvaluationOutput = z.infer<typeof evaluationOutputSchema>
export type StageOneOutput = z.infer<typeof stageOneOutputSchema>
export type RevisionOutput = z.infer<typeof revisionOutputSchema>
export type RankingOutput = z.infer<typeof rankingOutputSchema>
export type VerificationOutput = z.infer<typeof verificationOutputSchema>
