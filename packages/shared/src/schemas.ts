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

export const runOptionsSchema = z.object({
  evaluatorModels: z.array(modelRefSchema).default([]),
  verifierModels: z.array(modelRefSchema).default([]),
  /** Kept for the operator's audit trail. Ranks never enter scoring prompts. */
  showRanksToAgents: z.boolean().default(false),
  anchors: z.array(z.string()).default([]),
  maxRounds: z.number().int().min(1).max(3).default(2),
  temperature: z.number().min(0).max(1).default(0.2),
  concurrency: z.number().int().min(1).max(8).default(2),
  maxVideoMinutes: z.number().min(1).max(120).default(20),
  frameIntervalSeconds: z.number().min(2).max(120).default(20),
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

export type EvaluationOutput = z.infer<typeof evaluationOutputSchema>
export type RevisionOutput = z.infer<typeof revisionOutputSchema>
export type RankingOutput = z.infer<typeof rankingOutputSchema>
export type VerificationOutput = z.infer<typeof verificationOutputSchema>
