/**
 * Writes public/sw.js from sw/sw.template.js, stamped with this deployment's
 * build id. A byte-identical worker never triggers `updatefound`, so the stamp
 * is what lets the browser detect a new version and show the update prompt.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function buildId(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12)
  try {
    return execSync('git rev-parse --short=12 HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return `dev-${Date.now()}`
  }
}

const template = readFileSync(join(root, 'sw', 'sw.template.js'), 'utf8')
const output = template.replace('__BUILD_ID__', buildId())
mkdirSync(join(root, 'public'), { recursive: true })
writeFileSync(join(root, 'public', 'sw.js'), output)
console.log('[build-sw] public/sw.js stamped')
