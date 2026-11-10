import { parse as parseYaml } from 'yaml'
import { DEFAULT_RUBRIC } from './default-rubric'
import type { Rubric, RubricConsensus, RubricCriterion, RubricRanking, RubricRule, RubricScale } from './types'

export interface RubricParseResult {
  rubric: Rubric
  warnings: string[]
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return fallback
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => asString(entry).trim()).filter(Boolean)
  const single = asString(value).trim()
  return single ? [single] : []
}

function toWeight(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1 ? value / 100 : value
  const raw = asString(value)
  const percent = raw.match(/(\d+(?:[.,]\d+)?)\s*%/)
  if (percent) return Number(percent[1]!.replace(',', '.')) / 100
  const fromLabel = label.match(/\((\d+(?:[.,]\d+)?)\s*%\)/)
  if (fromLabel) return Number(fromLabel[1]!.replace(',', '.')) / 100
  const numeric = Number(raw.replace('%', '').replace(',', '.'))
  if (Number.isFinite(numeric) && raw.trim()) return numeric > 1 ? numeric / 100 : numeric
  return 0
}

/** Decode the small set of HTML entities a copied table can contain. */
function cleanCell(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function normaliseWeights(criteria: RubricCriterion[], warnings: string[]): RubricCriterion[] {
  const total = criteria.reduce((sum, criterion) => sum + criterion.weight, 0)
  if (total <= 0) {
    const equal = 1 / Math.max(1, criteria.length)
    warnings.push('No positive weights found; criteria are weighted equally.')
    return criteria.map((criterion) => ({ ...criterion, weight: equal }))
  }
  if (Math.abs(total - 1) > 0.001) {
    warnings.push(`Criteria weights sum to ${total.toFixed(3)}; normalised to 1.`)
    return criteria.map((criterion) => ({ ...criterion, weight: criterion.weight / total }))
  }
  return criteria
}

function parseScale(raw: unknown): RubricScale {
  const source = asRecord(raw)
  const min = Number(source.min)
  const max = Number(source.max)
  const step = Number(source.step)
  const anchorsRaw = Array.isArray(source.anchors) ? source.anchors : []
  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 100,
    step: Number.isFinite(step) && step > 0 ? step : 1,
    anchors: anchorsRaw.map((anchor) => {
      const entry = asRecord(anchor)
      const range = Array.isArray(entry.range) ? entry.range : []
      return {
        range: [Number(range[0] ?? 0), Number(range[1] ?? 0)] as [number, number],
        label: asString(entry.label, ''),
        ...(asString(entry.hint) ? { hint: asString(entry.hint) } : {}),
      }
    }),
  }
}

function parseRanking(raw: unknown): RubricRanking {
  const source = asRecord(raw)
  const provided = asRecord(source.providedRanks ?? source.provided_ranks)
  const anchors = asRecord(source.anchors)
  const scope = asString(source.scope, 'track') === 'global' ? 'global' : 'track'
  return {
    scope,
    primary: 'weighted_score',
    comparativePass: Boolean(source.comparativePass ?? source.comparative_pass ?? true),
    tieBreakers: asStringArray(source.tieBreakers ?? source.tie_breakers),
    providedRanks: {
      useInScores: Boolean(provided.useInScores ?? provided.use_in_scores ?? false),
      compareAfter: Boolean(provided.compareAfter ?? provided.compare_after ?? true),
    },
    anchors: {
      source: 'user_selection',
      max: Number(anchors.max) > 0 ? Number(anchors.max) : 3,
    },
  }
}

function parseConsensus(raw: unknown): RubricConsensus {
  const source = asRecord(raw)
  const aggregationRaw = asString(source.aggregation, 'trimmed_mean')
  const aggregation = aggregationRaw === 'mean' || aggregationRaw === 'median' ? aggregationRaw : 'trimmed_mean'
  const unresolved = asString(source.onUnresolved ?? source.on_unresolved, 'escalate')
  return {
    evaluators: Number(source.evaluators) > 0 ? Math.trunc(Number(source.evaluators)) : 6,
    verifiers: Number(source.verifiers) > 0 ? Math.trunc(Number(source.verifiers)) : 2,
    maxRounds: Number(source.maxRounds ?? source.max_rounds) > 0 ? Math.trunc(Number(source.maxRounds ?? source.max_rounds)) : 2,
    tolerancePoints: Number(source.tolerancePoints ?? source.tolerance_points) > 0 ? Number(source.tolerancePoints ?? source.tolerance_points) : 8,
    aggregation,
    requireEvidence: Boolean(source.requireEvidence ?? source.require_evidence ?? true),
    minEvidencePerCriterion: Number(source.minEvidencePerCriterion ?? source.min_evidence_per_criterion) > 0 ? Math.trunc(Number(source.minEvidencePerCriterion ?? source.min_evidence_per_criterion)) : 1,
    verifierAdjustmentLimit: Number(source.verifierAdjustmentLimit ?? source.verifier_adjustment_limit) > 0 ? Number(source.verifierAdjustmentLimit ?? source.verifier_adjustment_limit) : 10,
    onUnresolved: unresolved === 'average' ? 'average' : 'escalate',
  }
}

function parseCriteria(raw: unknown, warnings: string[]): RubricCriterion[] {
  if (!Array.isArray(raw)) return []
  const criteria: RubricCriterion[] = []
  for (const entry of raw) {
    const source = asRecord(entry)
    const label = asString(source.label ?? source.name ?? source.category, '').trim()
    if (!label) continue
    const id = asString(source.id).trim() || slug(label)
    criteria.push({
      id,
      label,
      weight: toWeight(source.weight, label),
      description: asString(source.description).trim(),
      questions: asStringArray(source.questions),
      evidence: asStringArray(source.evidence),
      signals: asStringArray(source.signals),
      redFlags: asStringArray(source.redFlags ?? source.red_flags),
    })
  }
  return normaliseWeights(criteria, warnings)
}

function isTableHeader(cells: string[]): boolean {
  const header = cells[0]?.toLowerCase() ?? ''
  return header.includes('category') || header.includes('criterion') || header.includes('critère')
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && /^:?-{2,}:?$/.test(cells[0] ?? '')
}

function rowToCriterion(cells: string[]): RubricCriterion | null {
  if (cells.length < 2) return null
  const first = cells[0] ?? ''
  if (!first || isSeparatorRow(cells)) return null
  const weight = toWeight(undefined, first)
  const label = first.replace(/\*\*/g, '').replace(/\(\s*\d+(?:[.,]\d+)?\s*%\s*\)/g, '').trim()
  const description = (cells[1] ?? '').trim()
  if (!label || !description) return null
  return {
    id: slug(label),
    label,
    weight,
    description,
    questions: [],
    evidence: [],
    signals: [],
    redFlags: [],
  }
}

/**
 * Parse a markdown criteria table. When a table header mentions "Category" /
 * "Criterion", only that table is read, so a preceding scoring-scale table
 * cannot be mistaken for criteria. Without a header, every two-column row is
 * considered, skipping separator rows.
 */
function parseMarkdownRubric(text: string, warnings: string[]): RubricCriterion[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const criteria: RubricCriterion[] = []

  const headerIndex = lines.findIndex((line) => {
    if (!line.startsWith('|')) return false
    return isTableHeader(line.split('|').slice(1, -1).map(cleanCell))
  })

  const sourceRows = headerIndex >= 0
    ? (() => {
        // Only the contiguous table that follows its header, never a later table.
        const rows: string[][] = []
        for (const line of lines.slice(headerIndex + 1)) {
          if (!line.startsWith('|')) {
            if (rows.length > 0) break
            continue
          }
          rows.push(line.split('|').slice(1, -1).map(cleanCell))
        }
        return rows
      })()
    : lines
        .filter((line) => line.startsWith('|'))
        .map((line) => line.split('|').slice(1, -1).map(cleanCell))

  for (const cells of sourceRows) {
    const criterion = rowToCriterion(cells)
    if (criterion) criteria.push(criterion)
  }
  if (criteria.length > 0 && criteria.every((criterion) => criterion.weight === 0)) {
    warnings.push('No weight found in the markdown table; criteria are weighted equally.')
  }
  return normaliseWeights(
    criteria.map((criterion) => (criterion.weight === 0 ? { ...criterion, weight: 1 } : criterion)),
    warnings,
  )
}

function parseRules(raw: unknown): RubricRule[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      const source = asRecord(entry)
      const label = asString(source.label ?? source.name, '').trim()
      if (!label) return null
      const severity = asString(source.severity, 'warn') === 'disqualify' ? 'disqualify' : 'warn'
      return {
        id: asString(source.id).trim() || slug(label),
        label,
        severity,
        check: asString(source.check ?? source.description).trim(),
      } satisfies RubricRule
    })
    .filter((entry): entry is RubricRule => entry !== null)
}

function fromObject(raw: unknown, warnings: string[]): Rubric {
  const source = asRecord(raw)
  const criteria = parseCriteria(source.criteria ?? source.categories, warnings)
  if (criteria.length === 0) throw new Error('The rubric contains no criteria.')

  const base = DEFAULT_RUBRIC
  return {
    version: Number(source.version) > 0 ? Number(source.version) : 1,
    name: asString(source.name, 'Uploaded rubric'),
    description: asString(source.description, ''),
    scale: parseScale(source.scale ?? base.scale),
    criteria,
    ranking: parseRanking(source.ranking ?? base.ranking),
    consensus: parseConsensus(source.consensus ?? base.consensus),
    rules: parseRules(source.rules ?? base.rules).length > 0 ? parseRules(source.rules ?? base.rules) : base.rules,
  }
}

/**
 * Parse a rubric from YAML/JSON, or from the markdown table an operator pastes.
 * The parser is intentionally permissive about key casing, but it never invents
 * a criterion: an empty rubric is an error.
 */
export function parseRubricText(text: string, filename?: string): RubricParseResult {
  const trimmed = text.trim()
  const warnings: string[] = []
  if (!trimmed) return { rubric: DEFAULT_RUBRIC, warnings: ['No rubric uploaded; using the neutral default.'] }

  const lower = (filename ?? '').toLowerCase()
  const looksJson = lower.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')
  const looksYaml = lower.endsWith('.yaml') || lower.endsWith('.yml') || /^[\w-]+:\s/m.test(trimmed)
  const looksMarkdown = lower.endsWith('.md') || lower.endsWith('.markdown') || trimmed.includes('|')

  if (looksJson) {
    try {
      return { rubric: fromObject(JSON.parse(trimmed), warnings), warnings }
    } catch (error) {
      if (looksMarkdown) return { rubric: fromObject({ criteria: parseMarkdownRubric(trimmed, warnings) }, warnings), warnings }
      throw error
    }
  }

  if (looksYaml) {
    try {
      return { rubric: fromObject(parseYaml(trimmed), warnings), warnings }
    } catch (error) {
      if (looksMarkdown) return { rubric: fromObject({ criteria: parseMarkdownRubric(trimmed, warnings) }, warnings), warnings }
      throw error
    }
  }

  const criteria = parseMarkdownRubric(trimmed, warnings)
  if (criteria.length === 0) throw new Error('No criteria found in the rubric.')
  return { rubric: fromObject({ criteria }, warnings), warnings }
}

export { DEFAULT_RUBRIC }
