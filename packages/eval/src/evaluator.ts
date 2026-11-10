import { createLanguageModel, modelRefKey, type ModelRef } from '@verdict/providers'
import { evaluationOutputSchema, type ProjectEvaluation, type ProjectEvidence, type ProjectInput, type Rubric } from '@verdict/shared'
import type { AgentDefinition } from './agents'
import { buildDossier } from './dossier'
import { normaliseEvaluation } from './normalise'
import { evaluatorPrompt, evaluatorSystem } from './prompts'
import { generateStructured, type UsageTotals } from './structured'

const JSON_CONTRACT = `{
  "scores": [
    {
      "criterionId": "exact rubric id",
      "score": 0,
      "confidence": 0.0,
      "evidence": ["repo:path/to/file", "video:123s"],
      "rationale": "short, checkable",
      "redFlags": ["only real disqualifiers"]
    }
  ],
  "summary": "short summary",
  "redFlags": ["project-level flags"],
  "relativeOrder": ["project-id"]
}`

export interface EvaluateArgs {
  project: ProjectInput
  evidence: ProjectEvidence
  rubric: Rubric
  rulesText: string
  agent: AgentDefinition
  modelRef: ModelRef
  temperature: number
}

export async function evaluateProject(args: EvaluateArgs): Promise<{ evaluation: ProjectEvaluation; usage: UsageTotals }> {
  const { project, evidence, rubric, rulesText, agent, modelRef, temperature } = args
  const dossier = buildDossier(project, evidence)
  const result = await generateStructured({
    model: createLanguageModel(modelRef),
    modelRef,
    schema: evaluationOutputSchema,
    system: evaluatorSystem(agent, rubric, rulesText),
    prompt: evaluatorPrompt(project, dossier),
    temperature,
    jsonContract: JSON_CONTRACT,
    ...(project.youtube ? { videoUrl: project.youtube } : {}),
  })

  return {
    evaluation: normaliseEvaluation(result.object, {
      projectId: project.id,
      agentId: agent.id,
      agentName: agent.name,
      model: modelRefKey(modelRef),
      rubric,
    }),
    usage: result.usage,
  }
}
