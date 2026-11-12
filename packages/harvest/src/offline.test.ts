import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectInput } from '@verdict/shared'
import { buildRepoArtifactFromDirectory } from './github'
import {
  archiveErrorMessage,
  createOfflineBundleReader,
  expandNestedArchives,
  indexOfflineBundle,
  mapOfflineBundle,
  offlineBundleCandidates,
  unsafeZipEntry,
  validateZipEntries,
} from './offline'

async function fixture(structure: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'verdict-offline-'))
  for (const [path, content] of Object.entries(structure)) {
    const absolute = join(root, path)
    await mkdir(join(absolute, '..'), { recursive: true })
    await writeFile(absolute, content)
  }
  return root
}

describe('indexOfflineBundle', () => {
  test('collects repository roots and videos, and ignores noise', async () => {
    const root = await fixture({
      'team-alpha/README.md': '# Alpha',
      'team-alpha/package.json': '{}',
      'team-alpha/src/index.ts': 'export const x = 1',
      'team-alpha/demo.mp4': 'fake',
      'team-alpha/node_modules/pkg/index.js': 'ignored',
      'videos/beta-pitch.mp4': 'fake',
      '__MACOSX/team-alpha/._README.md': 'junk',
      'notes.txt': 'hello',
    })
    try {
      const index = await indexOfflineBundle(root)
      const relative = (path: string) => path.slice(root.length + 1).replace(/\\/g, '/')
      expect(index.directories.map(relative).sort()).toEqual(['', 'team-alpha'])
      expect(index.videos.map(relative).sort()).toEqual(['team-alpha/demo.mp4', 'videos/beta-pitch.mp4'])
      expect(index.files.map((file) => file.path).sort()).toEqual([
        'notes.txt',
        'team-alpha/README.md',
        'team-alpha/package.json',
        'team-alpha/src/index.ts',
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('mapOfflineBundle', () => {
  test('matches a folder and a video by project name and video id', async () => {
    const root = await fixture({
      'team-alpha/README.md': '# Alpha',
      'team-alpha/package.json': '{}',
      'team-alpha/demo.mp4': 'fake',
      'beta/README.md': '# Beta',
      'beta/main.py': 'print(1)',
      'videos/beta-pitch.mp4': 'fake',
    })
    try {
      const index = await indexOfflineBundle(root)
      const projects: ProjectInput[] = [
        {
          id: 'alpha',
          name: 'Team Alpha',
          github: 'https://github.com/acme/team-alpha',
          youtube: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
        },
        { id: 'beta', name: 'Beta', youtube: 'https://www.youtube.com/watch?v=BBBBBBBBBBB' },
      ]
      const sources = mapOfflineBundle(index, projects)
      expect(sources.alpha?.directory?.endsWith('team-alpha')).toBe(true)
      expect(sources.alpha?.videoFile?.endsWith('team-alpha/demo.mp4')).toBe(true)
      expect(sources.beta?.directory?.endsWith('beta')).toBe(true)
      expect(sources.beta?.videoFile?.endsWith('videos/beta-pitch.mp4')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('falls back to the only folder for a single-project bundle', async () => {
    const root = await fixture({
      'bundle/README.md': '# A project',
      'bundle/app.py': 'print(1)',
    })
    try {
      const index = await indexOfflineBundle(root)
      const sources = mapOfflineBundle(index, [{ id: 'solo', name: 'Unrelated Name' }])
      expect(sources.solo?.directory?.endsWith('bundle')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('matches a decorated video name across a manifest typo', async () => {
    const root = await fixture({
      'repos/sarkiai-policy-sandbox-meta/README.md': '# SarkiAI',
      'repos/sarkiai-policy-sandbox-meta/main.py': 'print(1)',
      'videos/Mini-SarkiAI Policy Sandbox AI agents for government incident response.mp4': 'fake',
    })
    try {
      const index = await indexOfflineBundle(root)
      const sources = mapOfflineBundle(index, [
        {
          id: 'sarkiai-policy-sanbox-abc',
          name: 'SarkiAI Policy Sanbox',
          github: 'https://github.com/rouftom/sarkiai-policy-sandbox-meta',
        },
      ])
      expect(sources['sarkiai-policy-sanbox-abc']?.directory?.endsWith('sarkiai-policy-sandbox-meta')).toBe(true)
      expect(sources['sarkiai-policy-sanbox-abc']?.videoFile?.endsWith('incident response.mp4')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('manual matches win and one path feeds one project', async () => {
    const root = await fixture({
      'team-alpha/README.md': '# Alpha',
      'team-beta/README.md': '# Beta',
      'videos/beta-demo.mp4': 'fake',
    })
    try {
      const index = await indexOfflineBundle(root)
      const sources = mapOfflineBundle(
        index,
        [
          { id: 'alpha', name: 'Alpha' },
          { id: 'gamma', name: 'Gamma' },
        ],
        { gamma: { repository: 'team-alpha', video: 'videos/beta-demo.mp4' } },
      )
      expect(sources.gamma?.directory?.endsWith('team-alpha')).toBe(true)
      expect(sources.gamma?.videoFile?.endsWith('videos/beta-demo.mp4')).toBe(true)
      // The repository picked by hand is not also handed to Alpha.
      expect(sources.alpha).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('lists repositories and videos by bundle-relative path', async () => {
    const root = await fixture({
      'projects/team-alpha/README.md': '# Alpha',
      'projects/team-alpha/app.py': 'print(1)',
      'projects/videos/alpha-demo.mp4': 'fake',
    })
    try {
      const index = await indexOfflineBundle(root)
      const candidates = offlineBundleCandidates(index)
      expect(candidates.repositories.map((candidate) => candidate.path)).toContain('projects/team-alpha')
      expect(candidates.videos.map((candidate) => candidate.path)).toContain('projects/videos/alpha-demo.mp4')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('leaves an unmatched project out instead of guessing', async () => {
    const root = await fixture({
      'alpha/README.md': '# Alpha',
      'beta/README.md': '# Beta',
    })
    try {
      const index = await indexOfflineBundle(root)
      const sources = mapOfflineBundle(index, [
        { id: 'alpha', name: 'Alpha' },
        { id: 'gamma', name: 'Gamma' },
      ])
      expect(sources.alpha?.directory?.endsWith('alpha')).toBe(true)
      expect(sources.gamma).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('buildRepoArtifactFromDirectory', () => {
  test('indexes a local directory with README, key files and languages', async () => {
    const root = await fixture({
      'README.md': '# Local project',
      'package.json': '{"name":"local"}',
      'src/index.ts': 'export const answer = 42\n',
    })
    try {
      const artifact = await buildRepoArtifactFromDirectory(root, { url: 'https://github.com/acme/local' })
      expect(artifact.filesCount).toBe(3)
      expect(artifact.readme).toContain('Local project')
      expect(artifact.keyFiles.some((file) => file.path === 'package.json')).toBe(true)
      expect(artifact.languages.TypeScript).toBeGreaterThan(0)
      expect(artifact.url).toBe('https://github.com/acme/local')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('expandNestedArchives', () => {
  test('expands a repository archive shipped inside the bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'verdict-nested-'))
    try {
      const staging = join(root, 'staging', 'ORCA-main')
      await mkdir(join(staging, 'src'), { recursive: true })
      await writeFile(join(staging, 'README.md'), '# ORCA\n')
      await writeFile(join(staging, 'src', 'agent.py'), 'print("model")\n')
      const bundle = join(root, 'bundle')
      await mkdir(join(bundle, 'projects'), { recursive: true })
      await writeFile(join(bundle, 'projects', 'winners.json'), '[]')
      const archive = join(bundle, 'projects', 'ORCA-main.zip')
      const zipped = Bun.spawnSync(['zip', '-q', '-r', archive, 'ORCA-main'], { cwd: join(root, 'staging') })
      expect(zipped.exitCode).toBe(0)

      const expansion = await expandNestedArchives(bundle)
      expect(expansion.warnings).toEqual([])
      expect(expansion.directories).toHaveLength(1)
      expect(expansion.directories[0]!.endsWith('ORCA-main')).toBe(true)

      const index = await indexOfflineBundle(bundle)
      expect(index.directories.some((directory) => directory.endsWith('ORCA-main'))).toBe(true)
      // The hidden expansion folder is never a candidate itself, and its files
      // stay out of the text-candidate listing.
      expect(index.directories.some((directory) => directory.endsWith('.verdict-expanded'))).toBe(false)
      expect(index.files.some((file) => file.path.includes('.verdict-expanded'))).toBe(false)

      const sources = mapOfflineBundle(index, [
        { id: 'orca', name: 'ORCA by IssueLab', github: 'https://github.com/IssueLab-Inc/ORCA' },
      ])
      expect(sources.orca?.directory?.endsWith('ORCA-main')).toBe(true)

      // A second call reuses the extracted tree instead of duplicating it.
      const again = await expandNestedArchives(bundle)
      expect(again.directories).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('scans deep paths and leaves a nested archive for on-demand extraction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'verdict-recursive-'))
    try {
      const bundle = join(root, 'bundle')
      await mkdir(join(bundle, 'projects'), { recursive: true })
      await writeFile(join(bundle, 'projects', 'winners.json'), '[]')

      // A repository archive four directories down, past a shallow scan.
      const deep = join(root, 'staging', 'deep', 'alpha')
      await mkdir(join(deep, 'src'), { recursive: true })
      await writeFile(join(deep, 'README.md'), '# Alpha\n')
      await writeFile(join(deep, 'src', 'app.py'), 'print(1)\n')
      const deepTarget = join(bundle, 'one', 'two', 'three', 'four')
      await mkdir(deepTarget, { recursive: true })
      expect(
        Bun.spawnSync(['zip', '-q', '-r', join(deepTarget, 'alpha-main.zip'), 'alpha'], {
          cwd: join(root, 'staging', 'deep'),
        }).exitCode,
      ).toBe(0)

      // An archive that itself ships an archive.
      const outer = join(root, 'outer', 'outer-repo')
      await mkdir(join(outer, 'nested'), { recursive: true })
      await writeFile(join(outer, 'README.md'), '# Outer\n')
      const innerSource = join(root, 'inner', 'beta')
      await mkdir(join(innerSource, 'src'), { recursive: true })
      await writeFile(join(innerSource, 'README.md'), '# Beta\n')
      await writeFile(join(innerSource, 'src', 'main.py'), 'print(2)\n')
      expect(
        Bun.spawnSync(['zip', '-q', '-r', join(outer, 'nested', 'beta-main.zip'), 'beta'], {
          cwd: join(root, 'inner'),
        }).exitCode,
      ).toBe(0)
      expect(
        Bun.spawnSync(['zip', '-q', '-r', join(bundle, 'outer.zip'), 'outer-repo'], {
          cwd: join(root, 'outer'),
        }).exitCode,
      ).toBe(0)

      const expansion = await expandNestedArchives(bundle)
      expect(expansion.warnings).toEqual([])
      const names = expansion.directories.map((directory) => directory.split('/').pop())
      expect(names).toContain('alpha')
      expect(names).toContain('outer-repo')
      // An archive shipped inside a repository waits for the matching agent.
      expect(names).not.toContain('beta')

      // The agent opens it on demand, then a fresh index sees the repository.
      const reader = createOfflineBundleReader(await indexOfflineBundle(bundle))
      const outerRoot = expansion.directories.find((directory) => directory.endsWith('outer-repo'))!
      const nestedArchive = `${outerRoot.slice(bundle.length + 1)}/nested/beta-main.zip`
      const extracted = await reader.extract(nestedArchive)
      expect(extracted.warnings).toEqual([])
      expect(extracted.directories[0]?.path).toBe('.verdict-expanded/beta-main/beta')

      const index = await indexOfflineBundle(bundle)
      const sources = mapOfflineBundle(index, [
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Beta' },
      ])
      expect(sources.alpha?.directory?.endsWith('alpha')).toBe(true)
      expect(sources.beta?.directory?.endsWith('beta')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('warns instead of failing when a nested archive is corrupt', async () => {
    const root = await fixture({ 'projects/broken.zip': 'not a zip at all' })
    try {
      const expansion = await expandNestedArchives(root)
      expect(expansion.directories).toEqual([])
      expect(expansion.warnings.join(' ')).toContain('could not be expanded')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('zip entry validation', () => {
  test('rejects absolute, drive-letter and parent-traversal entries', () => {
    expect(unsafeZipEntry('/etc/passwd')).toBe(true)
    expect(unsafeZipEntry('C:/Windows/system32')).toBe(true)
    expect(unsafeZipEntry('../../secret')).toBe(true)
    expect(unsafeZipEntry('project/readme.md')).toBe(false)
    expect(() => validateZipEntries([])).toThrow('empty')
    expect(() => validateZipEntries(['../escape.txt'])).toThrow('unsafe path')
  })

  test('turns an unzip failure into a message that never leaks the cache path', () => {
    const stderr = 'Archive:  /var/cache/verdict/abc/bundle.zip\n  End-of-central-directory signature not found.'
    const message = archiveErrorMessage(stderr, '/var/cache/verdict/abc/bundle.zip', 'The archive could not be read.')
    expect(message).toBe('The uploaded file is not a valid zip archive.')
    expect(message).not.toContain('/var/cache')
  })

  test('strips the archive path from an unrelated unzip failure', () => {
    const stderr = 'unzip:  /var/cache/verdict/abc/bundle.zip permission denied'
    const message = archiveErrorMessage(stderr, '/var/cache/verdict/abc/bundle.zip', 'The archive could not be extracted.')
    expect(message).toContain('the archive')
    expect(message).not.toContain('/var/cache')
  })
})
