import { createLanguageModel, modelRefKey, type ModelRef } from '@verdict/providers'
import {
  revisionOutputSchema,
  type ProjectEvaluation,
  type ProjectEvidence,
  type ProjectInput,
  type ProjectRevision,
  type Rubric,
} from '@verdict/shared'
import type { AgentDefinition } from './agents'
import { anonymisedEvaluations, buildDossier } from './dossier'
import { normaliseEvaluation } from './normalise'
import { revisionPrompt, revisionSystem } from './prompts'
import { generateStructured, type UsageTotals } from './structured'

const JSON_CONTRACT = `{
  "scores": [{ "criterionId": "id", "score": 0, "confidence": 0.0, "evidence": ["repo:path"], "rationale": "text", "redFlags": [] }],
  "summary": "text",
  "redFlags": [],
  "relativeOrder": [],
  "changed": false,
  "changeReason": "text or empty"
}`

export interface ReviseArgs {
  project: ProjectInput
  evidence: ProjectEvidence
  rubric: Rubric
  rulesText: string
  agent: AgentDefinition
  modelRef: ModelRef
  temperature: number
  own: ProjectEvaluation
  all: ProjectEvaluation[]
  round: number
  signal?: AbortSignal
}

export async function reviseEvaluation(args: ReviseArgs): Promise<{ revision: ProjectRevision; usage: UsageTotals }> {
  const { project, evidence, rubric, rulesText, agent, modelRef, temperature, own, all, round, signal } = args
  const peers = anonymisedEvaluations(all, agent.id)
  const dossier = buildDossier(project, evidence)
  const result = await generateStructured({
    model: createLanguageModel(modelRef),
    modelRef,
    schema: revisionOutputSchema,
    system: revisionSystem(agent, rubric, rulesText),
    prompt: revisionPrompt(project, dossier, own, peers),
    temperature,
    jsonContract: JSON_CONTRACT,
    ...(signal ? { signal } : {}),
    ...(project.youtube ? { videoUrl: project.youtube } : {}),
  })

  const evaluation = normaliseEvaluation(result.object, {
    projectId: project.id,
    agentId: agent.id,
    agentName: agent.name,
    model: modelRefKey(modelRef),
    rubric,
  })

  return {
    revision: {
      ...evaluation,
      round,
      changed: result.object.changed,
      changeReason: result.object.changeReason,
    },
    usage: result.usage,
  }
}
