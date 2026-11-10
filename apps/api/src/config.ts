function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const config = {
  port: numberFromEnv('API_PORT', 8010),
  host: process.env.API_HOST?.trim() || '127.0.0.1',
  webOrigin: process.env.WEB_ORIGIN?.trim() || 'http://localhost:3010',
  bodyLimit: numberFromEnv('API_BODY_LIMIT_BYTES', 12 * 1024 * 1024),
  maxEventsPerRun: numberFromEnv('MAX_EVENTS_PER_RUN', 4000),
  maxRunsInMemory: numberFromEnv('MAX_RUNS_IN_MEMORY', 20),
}
