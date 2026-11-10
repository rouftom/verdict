import Fastify from 'fastify'
import cors from '@fastify/cors'
import { z } from 'zod'
import { EVALUATORS, VERIFIERS } from '@verdict/eval'
import { listProviders, modelPool } from '@verdict/providers'
import {
  parseManifestText,
  parseRubricText,
  runRequestSchema,
  type RunEvent,
} from '@verdict/shared'
import { config } from './config'
import { cancelRun, createRun, getRun, listRuns, parseInputs, pauseRun, resumeRun, subscribe } from './state'

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: config.bodyLimit,
})

await app.register(cors, {
  origin: config.webOrigin.split(',').map((origin) => origin.trim()).filter(Boolean),
  methods: ['GET', 'POST', 'OPTIONS'],
})

app.get('/health', async () => ({
  ok: true,
  service: 'verdict-api',
  uptimeSeconds: Math.round(process.uptime()),
  runs: listRuns().length,
}))

app.get('/providers', async (request) => {
  const query = z.object({ refresh: z.string().optional() }).safeParse(request.query)
  const force = query.success && query.data.refresh === '1'
  const providers = await listProviders({ force })
  const defaults = {
    evaluators: await modelPool('EVAL_MODELS', 6),
    verifiers: await modelPool('VERIFIER_MODELS', 2),
  }
  return {
    providers,
    /** The env-configured starting pool; the UI uses it for a fresh workspace. */
    defaults,
    /** Personas only: the pipeline graph labels one node per agent. */
    agents: {
      evaluators: EVALUATORS.map((agent) => ({ ...agent })),
      verifiers: VERIFIERS.map((agent) => ({ ...agent })),
    },
  }
})

app.post('/parse/manifest', async (request, reply) => {
  const schema = z.object({ text: z.string().min(1) })
  const body = schema.safeParse(request.body)
  if (!body.success) return reply.code(400).send({ error: 'Expected { text: string }.' })
  try {
    return parseManifestText(body.data.text)
  } catch (error) {
    return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/parse/rubric', async (request, reply) => {
  const schema = z.object({ text: z.string().default(''), filename: z.string().optional() })
  const body = schema.safeParse(request.body)
  if (!body.success) return reply.code(400).send({ error: 'Expected { text: string, filename?: string }.' })
  try {
    return parseRubricText(body.data.text, body.data.filename)
  } catch (error) {
    return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/runs', async (request, reply) => {
  const body = runRequestSchema.safeParse(request.body)
  if (!body.success) {
    return reply.code(400).send({
      error: 'Invalid run request.',
      issues: body.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`),
    })
  }
  try {
    const run = await createRun(body.data)
    return reply.code(201).send({
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
      manifest: { projects: run.manifest.length, warnings: run.warnings },
      rubric: { name: run.rubric.name, criteria: run.rubric.criteria.length },
      options: run.options,
    })
  } catch (error) {
    return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) })
  }
})

/** Dry parse for the upload preview: never starts a run. */
app.post('/runs/preview', async (request, reply) => {
  const schema = z.object({
    manifestText: z.string().min(1),
    rubricText: z.string().optional(),
    rubricFilename: z.string().optional(),
    rulesText: z.string().optional(),
  })
  const body = schema.safeParse(request.body)
  if (!body.success) return reply.code(400).send({ error: 'Invalid preview request.' })
  try {
    const parsed = parseInputs(body.data)
    return {
      projects: parsed.manifest,
      rubric: parsed.rubric,
      rulesChars: parsed.rulesText.length,
      warnings: parsed.warnings,
    }
  } catch (error) {
    return reply.code(422).send({ error: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/runs', async () => ({
  runs: listRuns().map((run) => ({
    id: run.id,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    projects: run.manifest.length,
    rubric: run.rubric.name,
    reportReady: Boolean(run.report),
    error: run.error,
  })),
}))

app.get<{ Params: { id: string } }>('/runs/:id', async (request, reply) => {
  const run = getRun(request.params.id)
  if (!run) return reply.code(404).send({ error: 'Run not found.' })
  return run
})

app.get<{ Params: { id: string } }>('/runs/:id/report', async (request, reply) => {
  const run = getRun(request.params.id)
  if (!run) return reply.code(404).send({ error: 'Run not found.' })
  if (!run.report) return reply.code(409).send({ error: 'The report is not ready yet.', status: run.status })
  return run.report
})

/**
 * Server-sent events. Every event already recorded is replayed first so a page
 * reload or a late subscriber never misses a stage.
 */
app.get<{ Params: { id: string } }>('/runs/:id/events', (request, reply) => {
  const run = getRun(request.params.id)
  if (!run) {
    void reply.code(404).send({ error: 'Run not found.' })
    return
  }

  // `reply.raw.writeHead` bypasses the Fastify CORS hook, and EventSource is a
  // cross-origin request in development. Echo the allowed origin here or the
  // browser blocks the stream as soon as it opens.
  const allowedOrigins = config.webOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const requestOrigin = request.headers.origin
  const allowOrigin =
    requestOrigin && (allowedOrigins.includes('*') || allowedOrigins.includes(requestOrigin))
      ? requestOrigin
      : allowedOrigins[0]

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin, Vary: 'Origin' } : {}),
  })

  const terminal = ['done', 'failed', 'cancelled'].includes(run.status)
  let closed = false
  let keepAlive: ReturnType<typeof setInterval> | undefined
  let unsubscribe: () => void = () => {}

  const finish = () => {
    if (closed) return
    closed = true
    if (keepAlive) clearInterval(keepAlive)
    unsubscribe()
    try {
      reply.raw.end()
    } catch {
      /* the socket may already be gone */
    }
  }

  const send = (event: RunEvent) => {
    if (closed) return
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    // A report or an error is the last useful frame of a run.
    if (event.type === 'report' || event.type === 'error') setTimeout(finish, 50)
  }

  for (const event of run.events) send(event)
  if (terminal) {
    setTimeout(finish, 50)
    return
  }
  reply.raw.write(': connected\n\n')

  unsubscribe = subscribe(run.id, send)
  keepAlive = setInterval(() => reply.raw.write(': ping\n\n'), 15_000)

  request.raw.on('close', () => {
    if (closed) return
    closed = true
    if (keepAlive) clearInterval(keepAlive)
    unsubscribe()
  })
})

app.post<{ Params: { id: string } }>('/runs/:id/cancel', async (request, reply) => {
  const run = getRun(request.params.id)
  if (!run) return reply.code(404).send({ error: 'Run not found.' })
  const cancelled = cancelRun(run.id)
  return { cancelled, status: run.status }
})

app.post<{ Params: { id: string } }>('/runs/:id/pause', async (request, reply) => {
  const run = getRun(request.params.id)
  if (!run) return reply.code(404).send({ error: 'Run not found.' })
  const result = pauseRun(run.id)
  if (!result) return reply.code(409).send({ error: 'Run is not active.' })
  return { paused: result.paused, status: run.status }
})

app.post<{ Params: { id: string } }>('/runs/:id/resume', async (request, reply) => {
  const run = getRun(request.params.id)
  if (!run) return reply.code(404).send({ error: 'Run not found.' })
  const result = resumeRun(run.id)
  if (!result) return reply.code(409).send({ error: 'Run is not active.' })
  return { paused: result.paused, status: run.status }
})

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error)
  const status = typeof (error as { statusCode?: number }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500
  const message = error instanceof Error ? error.message : String(error)
  void reply.code(status).send({ error: message })
})

const shutdown = async () => {
  await app.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await app.listen({ port: config.port, host: config.host })
app.log.info(`verdict-api ready on http://${config.host}:${config.port}`)
