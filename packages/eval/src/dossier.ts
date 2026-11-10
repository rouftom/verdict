import { projectTracks, type ProjectConsensus, type ProjectEvidence, type ProjectEvaluation, type ProjectInput, type Rubric } from '@verdict/shared'

const MAX_DOSSIER_CHARS = 42_000

/** Human label for every track a project is entered in. */
function trackLabel(project: ProjectInput): string {
  const tracks = projectTracks(project)
  if (tracks.length === 1 && tracks[0] === 'default') return 'unspecified'
  return tracks.join(', ')
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n… [truncated ${value.length - max} chars]`
}

function transcriptBlock(evidence: ProjectEvidence, maxChars: number): string {
  const transcript = evidence.video?.transcript
  if (!transcript) return 'No transcript available.'
  const lines: string[] = []
  let size = 0
  for (const segment of transcript.segments) {
    const line = `[${Math.round(segment.start)}s–${Math.round(segment.end)}s] ${segment.text}`
    if (size + line.length > maxChars) break
    lines.push(line)
    size += line.length
  }
  return lines.join('\n') || clip(transcript.text, maxChars)
}

/** Compact, citation-friendly evidence packet for one project. */
export function buildDossier(project: ProjectInput, evidence: ProjectEvidence): string {
  const repo = evidence.repo
  const video = evidence.video
  const sections: string[] = []

  sections.push(
    [
      'PROJECT',
      `name: ${project.name}`,
      `id: ${project.id}`,
      `track: ${trackLabel(project)}`,
      project.description ? `description: ${clip(project.description, 2_000)}` : 'description: (none supplied)',
      'The provided rank, if any, is deliberately withheld from this packet. Do not infer one.',
    ].join('\n'),
  )

  if (repo) {
    const languages = Object.entries(repo.languages)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([name, bytes]) => `${name} (${bytes} B)`)
      .join(', ')
    sections.push(
      [
        'REPOSITORY',
        `url: ${repo.url}`,
        `description: ${repo.description ?? '(none)'}`,
        `license: ${repo.license ?? 'not detected'}`,
        `stars: ${repo.stars ?? 'n/a'}`,
        `files: ${repo.filesCount} · LOC (text): ${repo.loc}`,
        `languages: ${languages || 'not detected'}`,
        `first seen: ${repo.firstCommitAt ?? 'unknown'} · last push: ${repo.lastCommitAt ?? 'unknown'}`,
        '',
        'FILE TREE (first 250 entries)',
        repo.tree.split('\n').slice(0, 250).join('\n'),
        '',
        'RECENT COMMITS',
        repo.commits.slice(0, 15).map((commit) => `- ${commit.date ?? '?'} ${commit.author ?? '?'}: ${commit.message}`).join('\n') || '(none)',
        '',
        'README',
        clip(repo.readme || '(no README)', 7_000),
      ].join('\n'),
    )

    let used = 0
    const keyFiles: string[] = []
    for (const file of repo.keyFiles) {
      if (used > 13_000) break
      const content = clip(file.content, 3_000)
      keyFiles.push(`### ${file.path}\n${content}`)
      used += content.length
    }
    sections.push(['KEY FILES', keyFiles.join('\n\n') || '(none selected)'].join('\n'))
  } else {
    sections.push('REPOSITORY\nNo repository evidence: the fetch failed or none was supplied.')
  }

  if (video) {
    sections.push(
      [
        'VIDEO',
        `url: ${video.url}`,
        `title: ${video.title ?? '(unknown)'}`,
        `duration: ${video.duration ? `${Math.round(video.duration)}s` : 'unknown'}`,
        `uploader: ${video.uploader ?? 'unknown'}`,
        '',
        'TRANSCRIPT (timestamps are seconds)',
        transcriptBlock(evidence, 13_000),
        '',
        'KEYFRAMES',
        video.frames.map((frame) => `- ${frame.atSeconds}s: ${frame.caption ?? frame.path}`).join('\n') || '(none)',
      ].join('\n'),
    )
  } else {
    sections.push('VIDEO\nNo video evidence: the fetch failed or none was supplied.')
  }

  if (evidence.errors.length > 0) {
    sections.push(['EVIDENCE ERRORS', ...evidence.errors.map((error) => `- ${error}`)].join('\n'))
  }

  return clip(sections.join('\n\n'), MAX_DOSSIER_CHARS)
}

/** One-line-per-project packet used by comparative ranking and verification. */
export function compactDossier(
  project: ProjectInput,
  consensus: ProjectConsensus | undefined,
  evidence: ProjectEvidence,
  rubric: Rubric,
): string {
  const scores = rubric.criteria
    .map((criterion) => `${criterion.label}=${consensus?.criteria.find((entry) => entry.criterionId === criterion.id)?.score ?? 'n/a'}`)
    .join(', ')
  const repo = evidence.repo ? `${evidence.repo.filesCount} files/${evidence.repo.loc} LOC` : 'no repo'
  const video = evidence.video
    ? `${Math.round(evidence.video.duration ?? 0)}s, ${evidence.video.transcript?.segments.length ?? 0} transcript segments, ${evidence.video.frames.length} frames`
    : 'no video'
  return [
    `- id: ${project.id}`,
    `  name: ${project.name}`,
    `  track: ${trackLabel(project)}`,
    `  overall: ${consensus?.overall ?? 'n/a'} (dispersion ${consensus?.dispersion ?? 'n/a'}, ${consensus?.status ?? 'n/a'})`,
    `  criteria: ${scores}`,
    `  evidence: ${repo}; ${video}`,
    project.description ? `  description: ${clip(project.description, 300)}` : undefined,
  ]
    .filter(Boolean)
    .join('\n')
}

export function anonymisedEvaluations(evaluations: ProjectEvaluation[], excludeAgentId: string): string {
  return evaluations
    .filter((evaluation) => evaluation.agentId !== excludeAgentId)
    .map((evaluation, index) =>
      [
        `EVALUATOR ${String.fromCharCode(65 + index)} (identity withheld)`,
        `overall: ${evaluation.overall}`,
        ...evaluation.scores.map((score) => `- ${score.criterionId}: ${score.score} (confidence ${score.confidence}): ${score.rationale} | evidence: ${score.evidence.join('; ') || 'none'}`),
        `summary: ${evaluation.summary}`,
      ].join('\n'),
    )
    .join('\n\n')
}
