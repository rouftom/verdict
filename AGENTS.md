# AGENTS.md

Guide for anyone, human or agent, taking over this repository. Read it before
changing code. The README is the user-facing introduction; this file is the
maintainer contract.

## What this is

`verdict` scores hackathon-style projects from evidence rather than from a
description alone. You upload a manifest of projects, optional eligibility rules
and an optional rubric. It harvests each GitHub repository and demo video, then
runs a fixed multi-agent pipeline and publishes a report.

There is no authentication and no database. Runs live in the API process; the
browser keeps snapshots and the last workspace configuration in IndexedDB.

## Pipeline invariants

These are product promises, not implementation details. Do not weaken them.

1. **Stage One gate**: before any scoring, every project is screened pass or
   fail on two statements: it reasonably fits a published track it entered, and
   it uses the event's AI tooling at runtime. The gate is deliberately strict
   and generic: prompts never name a vendor or a model. Only projects that pass
   are evaluated, reviewed, ranked or verified. Failed projects stay visible in
   the results with their rationale. A screening call that cannot complete
   fails open, with an explicit manual-review note, so a broken call never
   silently drops a project.
2. **Six evaluator agents** score every project independently, and every
   evaluator scores the same four criteria:
   Impact 30%, Use of AI Tooling 25%, Technical Depth and Execution 20%,
   Demo 25%.
3. **One cross-review round**: each evaluator sees the other five, anonymised,
   and may revise with a written justification.
4. **Consensus**: trimmed mean per criterion, spread and MAD dispersion.
5. **Comparative ranking** per track, aggregated by Borda count. A project can
   enter several tracks through `tracks`, so it is ranked in each of them. A
   ranking is always produced, even for a single project, and a track with no
   passing project keeps its empty ranking so the track selector still lists it.
6. **Two verifier agents** audit the evaluations, then reconcile criterion
   scores and the per-track ranking.
7. **Report**: final scores, ranking, supplied-rank delta, harvest errors and
   token usage.

Supplied ranks are optional and **never** influence criterion scores. A supplied
`rank` applies to the project's primary track only; award and secondary tracks
are ranked from the scores. Ranks are shown to the comparative ranking pass only
when the workspace option is on, and only after every criterion score is fixed.
Duplicate supplied ranks are normal across tracks: the manifest parser reports
them as one generic warning and never lists the affected projects or tracks.
Up to three projects can be chosen as calibration anchors. Anchors get no bonus
and may come from another track.

Every model call is bounded (five minutes) and still honours run cancellation,
so a provider that never answers cannot freeze the pipeline. A failed call is
recorded as an error event and the run moves on.

Repository and video content is untrusted data. The prompts say so explicitly.
Never let harvested text become an instruction.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/api` | Fastify server, SSE stream, in-memory run store (`src/state.ts`) |
| `apps/web` | Next.js 16 App Router workspace, client state, IndexedDB, PWA shell |
| `packages/shared` | domain types, zod schemas, manifest and rubric parsers, consensus |
| `packages/providers` | provider registry, AI SDK model factory, reasoning mapping |
| `packages/harvest` | GitHub tarball and indexing, yt-dlp, frames, transcription |
| `packages/eval` | agent roles, dossiers, prompts, evaluator, revision, ranking, verifiers, orchestrator |
| `packages/ui` | shared UI kit and design tokens |
| `packages/theme` | theme packs, corner and mode defaults, pre-paint bootstrap |
| `apps/web/sw` | Workbox service-worker template (the generated `public/sw.js` is ignored) |
| `apps/web/scripts` | build helpers, including the service-worker stamping script |

The API entry point is `apps/api/src/index.ts`; the pipeline is driven by
`packages/eval/src/orchestrator.ts`. The workspace UI is mostly
`apps/web/src/components/verdict-workspace.tsx`, with `lib/api.ts` for HTTP and
`lib/idb.ts` for local persistence.

## Commands

Run from the repository root.

| Command | What it does |
| --- | --- |
| `bun install` | install every workspace |
| `bun run dev` | API and web together through Turbo |
| `bun run build` | typecheck/build every package; stamps the service worker first |
| `bun run typecheck` | `tsc --noEmit` in every workspace |
| `bun run test` | `bun test` in every package that has tests |
| `bun run clean` | remove build output and `node_modules` |

Single workspace:

```bash
cd apps/api && bun run dev      # http://127.0.0.1:8010
cd apps/web && bun run dev      # http://localhost:3010
cd apps/web && bun run build
cd apps/web && bun run start
```

Setup:

```bash
cp .env.example .env
chmod 600 .env
bun install
```

Open `http://localhost:3010`, not `127.0.0.1`, so the browser origin matches
`WEB_ORIGIN` for CORS.

## Conventions

### Secrets

- `.env` is mode 600 and gitignored. Never read, print, copy or commit it.
- Only `.env.example` and documented placeholders are editable.
- Reference variable **names** in docs, commits and chat, never values.
- Do not paste a key into a command line. Use the environment or the file the
  tool reads.
- Before committing, audit the staged file list. Stop if anything matches
  `.env*`, `*.pem`, `*.key` or a credential file.
- Provider keys reach the API process only. Client bundles receive public values
  only.

### Typography and formatting

- No em dashes anywhere in the repository, documentation and commit messages
  included. Use a colon, a comma or parentheses.
- Do not add decorative runs of hyphens around section titles or step comments.
  Write a plain heading or comment.
- Markdown table separators, YAML document markers and CLI flags such as
  `--env-file` are syntax, not decoration. Leave them alone.
- Prefer short sentences and sentence case in UI labels.

### Next.js 16

This is Next.js 16, whose conventions differ from older releases. Before
changing `apps/web`, read the relevant guide in
`apps/web/node_modules/next/dist/docs/` or
`node_modules/next/dist/docs/`. Do not assume routing, metadata or caching
behaviour from memory.

`apps/web/AGENTS.md` is generated by `next dev`, is listed in `.gitignore` and
must stay untracked. This root file is the source of truth. If `next dev`
rewrites its generated file, leave it alone.

### Workspace UI

- Single-screen workspace. Inputs and Models are collapsible through
  `SectionCard`; the run bar stays pinned to the bottom of the viewport.
- Inputs are **file pickers only**. Do not reintroduce textareas for the
  manifest, rules or rubric.
- The three Inputs pickers live in one responsive grid. Each `UploadCard` is
  `h-full` with a `flex-1` dashed column, and its title row is `min-h-7`, so the
  dashed boxes keep the same height even when one column has a clear button, a
  longer hint or extra shortcuts.
- The rubric picker carries the Built-in and Generic YAML shortcuts at the flex
  end of the picker row.
- Models is one block in two columns: six evaluators on the left, two verifiers
  and the run options on the right.
- `SearchSelect` is the grouped combobox behind the model, reasoning and
  language pickers. Its search field carries `border-0` on purpose: the global
  input rule adds a 1 px border, and this field must blend into the search row
  next to the icon.
- The pipeline appears only after a run starts. Ranking and project detail
  appear as soon as results arrive. One bottom-bar toggle switches between the
  pipeline view and the results view, so only one is on screen at a time.
- Large lists stay virtualised: `react-virtuoso` for the run log, the ranking
  and the Stage One project list in its node card. React Flow keeps every node
  mounted, so a live update never drops a node card or its open panel.
- Calibration anchors cap at three and show the `n/3` count. Long names are
  truncated in the chip, the chip list scrolls instead of pushing the section
  taller, and above three projects a small case-insensitive field filters the
  chips by name.
- Results carry a track selector when a ranking spans several tracks. It is
  view state only: never re-rank or call the API, and when the current project
  is outside the chosen track fall back to that track's first entry.
- All six evaluators score all four criteria. The model pool is cycled across
  the fixed roles.

### Appearance

- One appearance menu in the header: theme pack, mode (light, dark, system) and
  corners (square or rounded).
- System mode follows `prefers-color-scheme`. An explicit choice wins.
- Square corners are the default and apply to the whole interface, pills
  included. The `data-radius` attribute drives this.
- Theme packs live in `packages/theme/src/packs/*.json`. Add a pack by adding the
  JSON file and importing it in `packages/theme/src/index.ts`. Keep the stored
  preference key stable; add a fallback when renaming an id.

### Languages

- UI text goes through `react-i18next`; resources live in
  `apps/web/src/locales/{en,fr,zh,hi}.json` and all four files must carry the
  same keys. `bun run test` checks key parity and rejects em dashes.
- The first render is English on both the server and the client; `I18nProvider`
  applies the stored preference right after hydration and keeps `<html lang>`
  in sync. Do not read `localStorage` during render, it would reintroduce a
  hydration mismatch.
- The header globe selector writes the `verdict-language` cookie plus the same
  `localStorage` key. It sits after the History button and stays compact (short
  codes only). Add a language by adding its JSON file, its entry in
  `src/lib/i18n.ts`, and its section in the parity test.
- Agent names and lenses are translated by id under `agents.*`; server-provided
  summaries, rationales, project names and other evidence stay data, not UI
  copy. Never translate user content.

### Service worker

- Edit `apps/web/sw/sw.template.js`, never `apps/web/public/sw.js`. The latter
  is generated at build time and gitignored.
- Caching must never touch API or SSE traffic. Cross-origin requests are
  network-only.
- Bump the cache prefix or the cleanup logic when changing cache semantics, and
  keep the offline fallback page working.
- Development must not leave a worker behind: `src/lib/sw-registration.ts`
  unregisters workers and clears caches outside production.

### Tab favicon

- `apps/web/src/hooks/use-processing-favicon.ts` paints a pulsing dot on every
  declared `rel="icon"` link while a run is active, then restores the original
  `href`, `type` and `sizes` when it settles. Same pattern as the organization
  console.
- Call it once from the workspace with the `running` flag. Never tie it to a
  finished run, and never swap a single hardcoded icon: Next.js declares
  several icon links and the browser keeps the untouched one.

### Brand assets

- Source of truth is `apps/web/public/logo.svg`.
- Raster icons in `apps/web/public/icons/` and `favicon.ico` are derived from it.
  When the mark changes, re-render them rather than editing PNGs by hand.
- The manifest is `apps/web/src/app/manifest.ts`; keep icon paths and theme
  colours aligned with the assets.

## Verification

Before opening or updating a pull request:

```bash
bun run typecheck
bun run test
bun run build
```

Then start both apps and check the pages return 200:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8010/health
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3010/
```

Report each command and its result. A red check blocks the merge. If a check
cannot run because a tool or provider is unavailable, say which one and what was
verified instead. Never claim that tests pass without running them.

For UI work, verify in a browser at desktop, tablet and phone widths. Check the
pinned run bar, the collapsed state, keyboard focus and the absence of
`textarea` elements in the inputs.

## Git and pull requests

- Never push directly to `main` or another protected branch.
- Branch from the integration branch with a `feat/`, `fix/`, `chore/`, `docs/`,
  `refactor/`, `test/` or `perf/` prefix.
- One logical change per pull request. Do not mix unrelated refactors.
- Use Conventional Commits with a scope, for example
  `feat(workspace): pin the run bar`.
- Do not force-push or rewrite shared history. Do not merge your own pull
  request unless asked, and do not enable auto-merge.
- After a merge, delete the branch, sync the base branch and report the link.
- Keep `apps/web/AGENTS.md` and other generated files out of commits.

## Adding a provider or a model

1. Declare the provider, its key, its base URL and its model discovery in
   `packages/providers/src/registry.ts`. Model lists are never hardcoded: the
   registry reads each provider's model endpoint and treats `<PROVIDER>_MODELS`
   as a fallback only.
2. Map the reasoning effort in `packages/providers/src/reasoning.ts` and its
   tests. Runware ids can arrive hyphenated from `/v1/models`, so family
   detection accepts both `:` and `-`.
3. Add the variable names to `.env.example` and to the README environment
   section. Never add values.
4. Confirm the model pickers show the provider only when it is configured, and
   that a failed endpoint surfaces the provider name instead of an empty list.
5. Run `bun run test`, because the registry and reasoning tests cover the public
   shape, discovery, the fallback and the model pool.

## Adding an input format or criterion

Parsers live in `packages/shared/src`. Keep zod schemas and TypeScript types in
sync. If a rubric changes weights, the four criteria and their default weights
must remain the documented baseline unless the user explicitly asks for a new
rubric. Preserve the rule that supplied ranks never enter scoring prompts.

## Troubleshooting

- **CORS or a blank providers list**: open the web app on `localhost`, not
  `127.0.0.1`, and check `WEB_ORIGIN` and `NEXT_PUBLIC_API_URL`.
- **A provider is missing from the pickers**: its key is not configured in the
  API process. The UI only shows configured providers.
- **A configured provider has no models**: its model endpoint failed. The Models
  section names it, `<PROVIDER>_MODELS` is used as the fallback, and
  `GET /providers?refresh=1` retries without waiting for the cache.
- **A stale bundle in development**: run the app in dev mode, where any service
  worker is unregistered and caches are cleared. Hard-reload once if a worker
  from a previous production test is still controlling the page.
- **Runs disappear after an API restart**: run state is in memory by design. The
  browser still has saved reports in IndexedDB.
- **Harvest errors**: check `yt-dlp`, `ffmpeg`, `ffprobe`, `YTDLP_PATH` and the
  GitHub token. A failed harvest is reported per project, not silently dropped.
