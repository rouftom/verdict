<p align="center">
  <img src="./apps/web/public/logo.svg" width="88" height="88" alt="verdict logo" />
</p>

<h1 align="center">verdict</h1>

<p align="center">
  Evidence-grounded, multi-agent evaluation of hackathon-style projects.
</p>

<p align="center">
  <a href="https://bun.sh"><img alt="Bun 1.4.2" src="https://img.shields.io/badge/Bun-1.4.2-000000?logo=bun&logoColor=white" /></a>
  <a href="https://nextjs.org"><img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white" /></a>
  <a href="https://react.dev"><img alt="React 19" src="https://img.shields.io/badge/React-19-087EA4?logo=react&logoColor=white" /></a>
  <a href="https://www.typescriptlang.org"><img alt="TypeScript 5.6" src="https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white" /></a>
  <a href="https://turbo.build"><img alt="Turbo 2.3" src="https://img.shields.io/badge/Turbo-2.3-EF4444?logo=turborepo&logoColor=white" /></a>
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-3DA639" />
</p>

<p align="center">
  <a href="https://socket.dev"><img alt="Dependencies monitored by Socket" src="https://img.shields.io/badge/Socket-monitored-4B32C3?logo=socket&logoColor=white" /></a>
  <a href="https://zod.dev"><img alt="Inputs validated with Zod" src="https://img.shields.io/badge/input-Zod-3068B7?logo=zod&logoColor=white" /></a>
  <img alt="Secrets: environment only" src="https://img.shields.io/badge/secrets-env--only-3DA639" />
  <img alt="No telemetry" src="https://img.shields.io/badge/telemetry-none-3DA639" />
  <img alt="Storage: browser only" src="https://img.shields.io/badge/storage-browser--only-3DA639" />
</p>

Upload a manifest of projects, the rules, and a rubric. `verdict` harvests each
project's GitHub repository and demo video, then runs:

1. **Stage One gate**: pass or fail per project, on track fit and runtime use of
   the event AI tooling. Only projects that pass are scored; failed projects stay
   in the results with their rationale.
2. **6 evaluator agents**: each scores the *same* weighted criteria
   independently.
3. **1 cross-review round**: every agent sees the other five, anonymised, and
   may revise with a written justification.
4. **Consensus**: trimmed mean per criterion, spread, and MAD dispersion.
5. **Comparative ranking**: one ordinal pass per track, aggregated by Borda
   count. Ranking is always produced, even with a single project.
6. **2 verifier agents**: audit the six evaluations, then reconcile final
   criterion scores and the per-track ranking.
7. **Report**: final scores, ranking, supplied-rank delta, evidence errors,
   token usage.

No authentication, no database. Run snapshots and the last workspace
configuration live in the browser's IndexedDB.

## Security

- The browser never holds a provider key. Keys are read from the API process
  environment, and `/providers` only returns the model catalog plus a
  `configured` flag per provider.
- Every manifest, rubric and run request is parsed with a Zod schema before it
  is used. The manifest parser refuses an empty project list, and the rubric
  parser refuses a rubric without criteria.
- Run state lives in the API process memory and in the browser's IndexedDB.
  There is no account, no cookie session and no server-side user data store.
- No analytics, telemetry or third-party trackers are loaded. The only outbound
  calls are the provider APIs and the GitHub/YouTube harvest for the projects in
  the manifest.
- Socket scans dependency changes on every pull request. Locally, the gates are
  `bun run typecheck`, `bun run test` and `bun run build`.

## Requirements

| Tool | Why |
| --- | --- |
| [Bun](https://bun.sh) ≥ 1.4.2 | package manager, API runtime, scripts |
| Node.js ≥ 20 | Next.js |
| `yt-dlp` | download YouTube demos (`YTDLP_PATH` overrides the binary) |
| `ffmpeg` / `ffprobe` | extract audio and keyframes (`FFMPEG_PATH`, `FFPROBE_PATH`) |
| `zlib` | only for the Python `yt-dlp` zipapp; the self-contained binary does not need it |

Without `yt-dlp`, runs still work on the repository evidence alone; the missing
video is recorded in the report's harvest errors. Without `ffmpeg`, no frames
and no transcription.

### Installing yt-dlp

The Python zipapp (the file named `yt-dlp` in the release assets) imports
`zlib` through Python's `zipimport`. Check the interpreter that `PATH` resolves:

```bash
python3 -c "import zlib; print(zlib.ZLIB_VERSION)"
```

If that fails while the system interpreter has it (for example `python3` is a
`/usr/local/bin/python3` built without zlib, but `/usr/bin/python3` works), run
the zipapp with the working interpreter, install zlib for the former, or use the
self-contained Linux build, which embeds its own runtime:

```bash
mkdir -p ~/.local/bin
curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  -o ~/.local/bin/yt-dlp
chmod +x ~/.local/bin/yt-dlp
export PATH="$HOME/.local/bin:$PATH"   # or set YTDLP_PATH
yt-dlp --version
```

On a Debian/Ubuntu host the zlib runtime is `zlib1g` (and `zlib1g-dev` only if
you build Python yourself):

```bash
sudo apt-get install -y zlib1g zlib1g-dev
```

`YTDLP_IMPERSONATE` only accepts a target listed by
`yt-dlp --list-impersonate-targets`; the release binary ships `curl_cffi` and
supports the usual browser profiles.

## Setup

```bash
git clone https://github.com/rouftom/verdict.git
cd verdict
cp .env.example .env        # then fill in the providers you use
chmod 600 .env

bun install
```


`.env` is gitignored and must never be committed. Only key names belong in the
transcript, a commit or a chat message.

## Run

```bash
# both apps, via Turbo
bun run dev

# or separately
cd apps/api && bun run dev    # http://127.0.0.1:8010
cd apps/web && bun run dev    # http://localhost:3010
```

Open <http://localhost:3010>. Use `localhost`, not `127.0.0.1`, so it matches
`WEB_ORIGIN` for CORS.

Production build:

```bash
bun run build
cd apps/web && bun run start
```

### PWA and offline

`bun run build` runs `apps/web/scripts/build-sw.ts` first. It copies
`apps/web/sw/sw.template.js` to the gitignored `apps/web/public/sw.js` and stamps
it with the commit id, so every deploy registers a new worker. Navigations are
network-first, images and fonts cache-first, styles and scripts
stale-while-revalidate, and API or SSE requests are network-only. `next dev`
unregisters any worker and clears its caches, so HMR never serves a stale bundle.

The web app manifest is `apps/web/src/app/manifest.ts`. The logo, icons and the
offline page live under `apps/web/public/`.

## Environment

Everything is environment-driven. The full template is
[`.env.example`](./.env.example); the app reads the values at runtime from the
repo-root `.env`.

```bash
# server
API_PORT=8010
API_HOST=127.0.0.1
WEB_ORIGIN=http://localhost:3010
NEXT_PUBLIC_API_URL=http://localhost:8010
LOG_LEVEL=info
MAX_RUNS_IN_MEMORY=20
MAX_EVENTS_PER_RUN=2000

# providers: set the key(s) you have
MODEL_API_KEY=            # Meta Model API (OpenAI-compatible), META_BASE_URL
OPENAI_API_KEY=           # OPENAI_BASE_URL
ANTHROPIC_API_KEY=        # ANTHROPIC_BASE_URL
GOOGLE_GENERATIVE_AI_API_KEY=   # GOOGLE_API_KEY, GOOGLE_BASE_URL
XAI_API_KEY=              # or GROK_API_KEY, XAI_BASE_URL
RUNWARE_API_KEY=
GROQ_API_KEY=             # OpenAI-compatible, GROQ_BASE_URL
DEEPSEEK_API_KEY=         # DEEPSEEK_BASE_URL
NEBIUS_API_KEY=           # NEBIUS_BASE_URL
NVIDIA_API_KEY=           # NVIDIA_API_URL
OLLAMA_BASE_URL=          # local, OpenAI-compatible

# model catalogs come from each provider's own model endpoint.
# <PROVIDER>_MODELS is a fallback used only when that endpoint fails
# (comma list or JSON array); empty = no fallback.
META_MODELS=
OPENAI_MODELS=
ANTHROPIC_MODELS=
GOOGLE_MODELS=
XAI_MODELS=
RUNWARE_MODELS=
GROQ_MODELS=
DEEPSEEK_MODELS=
NEBIUS_MODELS=
NVIDIA_MODELS=
OLLAMA_MODELS=

# model discovery cache and limits
PROVIDER_MODELS_TTL_SECONDS=600        # successful list cache
PROVIDER_MODELS_ERROR_TTL_SECONDS=60   # failed list cache
PROVIDER_MODELS_TIMEOUT_MS=6000        # per-provider request timeout

# agent defaults (comma list of provider:model); entries missing from the
# discovered catalog are dropped, and an empty or fully stale pool cycles the
# discovered models.
EVAL_MODELS=
VERIFIER_MODELS=

# reasoning effort per provider (none|minimal|low|medium|high|xhigh|max, or a token budget)
REASONING_EFFORT=
REASONING_EFFORT_ANTHROPIC=   # maps to Anthropic `effort` or a thinking budget
REASONING_EFFORT_GOOGLE=      # maps to `thinkingLevel` or `thinkingBudget`
REASONING_EFFORT_OPENAI=      # maps to `reasoningEffort`
REASONING_EFFORT_GROQ=
REASONING_EFFORT_NVIDIA=
REASONING_EFFORT_RUNWARE=

# transcription: any OpenAI-compatible /audio/transcriptions endpoint
TRANSCRIPTION_BASE_URL=
TRANSCRIPTION_API_KEY=
TRANSCRIPTION_MODEL=whisper-large-v3-turbo
TRANSCRIPTION_SEGMENT_SECONDS=30

# YouTube
YTDLP_COOKIES_BASE64=     # base64 of a Netscape cookies.txt, written mode 600 at runtime
YTDLP_IMPERSONATE=        # optional, e.g. chrome
YTDLP_EXTRACTOR_ARGS=     # optional, e.g. youtube:player_client=web
YTDLP_MAX_HEIGHT=360       # highest downloaded video height, in pixels
YTDLP_PATH=yt-dlp
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
MAX_VIDEO_MINUTES=20
FRAME_MAX=24
MAX_REPO_BYTES=62914560
```

A provider appears in the model pickers only when its key is configured. The
UI always offers six evaluator slots and two verifier slots; the same model can
fill several slots (useful for a single-provider demo), but diversity is
recommended.

Each slot has a searchable model select (models are grouped by provider) and
its own reasoning selector (`Auto`, `None`, `Minimal`, `Low`, `Medium`, `High`,
`Extra high`, `Max`). `Auto` keeps the environment default; any other value is
stored on that agent's `ModelRef` and overrides the env for that call only. The
choice is persisted with the workspace settings and the run snapshot.

### Reasoning effort

A per-agent selector (above) wins. Otherwise `REASONING_EFFORT_<PROVIDER>` is
used, then the global `REASONING_EFFORT`. The value is translated to each
provider's own knob:

| Provider | Mapping |
| --- | --- |
| Anthropic | `none`/`minimal` → thinking disabled; `low…max` → `effort`; a number → `thinking.budgetTokens` |
| Google | `none` → budget 0; `minimal…high` → `thinkingLevel`; `xhigh`/`max` → `high`; a number → `thinkingBudget` |
| OpenAI | `reasoningEffort`, full range |
| xAI | `reasoningEffort`, `none…xhigh` (`minimal`→`low`, `max`→`xhigh`) |
| Groq | `reasoning_effort`, `low`/`medium`/`high` |
| Meta, DeepSeek, Nebius, Ollama | `reasoning_effort`, `low`/`medium`/`high` |
| NVIDIA | `reasoning_effort`, full range |
| Runware | depends on the AIR family: Anthropic and DeepSeek full range, xAI `low…xhigh`, Google `none`/`low…high`, Kimi/GLM/MiniMax `low…high` |

The UI lists only the levels the selected provider and model accept. An env
value outside that range is clamped to the nearest supported level before it is
sent, so a rejected request never reaches the provider.

Leave it empty to send nothing. An unrecognised value is ignored, never
forwarded to an API that would reject it.

## Inputs

| Input | Formats | Notes |
| --- | --- | --- |
| Manifest | JSON, YAML | Array, `{ projects: [] }`, or a single object. Fields: `name`, `track` (single), `tracks` (array), `github`/`repo`, `youtube`/`video`, `rank`, `description`, `team`. |
| Evaluation rules | Markdown, TXT | Passed verbatim to every agent as untrusted context. Optional. |
| Rubric | YAML, JSON, Markdown table | Optional; the built-in neutral rubric is used when empty. |

Example inputs ship inside the repository:

- `apps/web/public/rules/judging-rubric.generic.yaml` / `.md`: neutral rubric,
  same weights as the organiser rubric (Impact 30%, Use of AI Tooling 25%,
  Technical Depth & Execution 20%, Demo 25%).
- `apps/web/public/rules/hackathon-rules.example.md`: generic example rules
  upload, with no organiser or provider branding. It defines two participant
  tracks (Indie Developer, Startup) and three award tracks (Best agentic use
  case, Best creative build, Best build on Open Weight).

Track values are free-form: whatever string a project carries in `track` or
`tracks` becomes a ranking group. `tracks` is the multi-track field, so a
project can be ranked in a participant track and several award tracks at the
same time; the first entry is the primary track. Every track, participant or
award, gets its own ranking, and a supplied `rank` applies to the primary track
of that project only. Other tracks are ranked from the scores alone.

The example manifest (`winners.json`) is deliberately kept **outside** this
repository, next to the organiser rubric, so frequent edits to it never cause a
merge conflict. Load it with *Choose file* when you need it.

The built-in default is the generic neutral rubric. The organiser's exact
rubric wording is deliberately **not** part of this repository: pass it as a
custom rubric upload (YAML, JSON or Markdown) when a run must score with the
original text.

## Supplied ranks and anchors

- Provided ranks **never** enter the six evaluators' scoring prompts.
- With *Show supplied ranks to the ranking pass* on, ranks are shown only to the
  comparative ranking pass, **after** every criterion score is fixed, as
  context that must not change a score.
- The report always shows a supplied-rank delta, compared **per track**. Ranks
  supplied in a manifest restart at 1 in each track.
- Repeated supplied ranks are expected, since every track restarts at 1. When a
  manifest carries duplicates, the validation strip shows **one generic
  warning**: it names no project and no track, however many entries repeat a
  rank.
- Up to three projects can be selected as calibration anchors. Anchors are
  ranked normally, get no bonus, and may come from another track (their
  dossier is passed to the ranking pass as calibration only).

## Workspace

The workspace has:

- inputs in **three responsive columns** (project manifest, evaluation rules
  and rubric), each a file picker, with a live validation strip underneath
  (project count, criteria and weights, warnings, anchors). The three dashed
  pickers share a height: each card fills its grid cell, the picker grows to
  fill the card, and the title row keeps a fixed height whether or not a clear
  button appears. The rubric row also carries the **Built-in** and **Generic
  YAML** shortcuts, aligned to the end of the picker row. **Calibration anchors
  (max 3)** shows the selected count, truncates long project names and, once a
  manifest has more than three projects, adds a small filter field above a
  scrollable chip list;
- one **Models** block in two columns: **six evaluators** on the left, the
  **two verifiers** and the run **options** on the right, each agent slot
  carrying its own model and reasoning select;
- grouped, searchable selects for models, reasoning effort and language, whose
  search field sits flush next to the search icon with no border of its own;
- collapsible **Inputs** and **Models** sections, so a long run does not push
  the controls around;
- a React Flow pipeline, shown once a run starts, where harvest fans out to **one node per evaluator**
  (six in parallel), converges on cross-review, consensus and ranking, then fans
  out to **one node per verifier** before the report. Click any agent node for a
  live synthesis popover: model, effort, project, per-criterion scores,
  confidence, summary, red flags, revisions and verifier adjustments;
- a per-track ranking and a project detail table, shown as soon as results
  start arriving (consensus, spread, final
  scores, evaluator matrix, verifier adjustments, harvest errors);
- a **track selector** above the ranking when a run spans several tracks:
  show one track at a time or keep them all in one scroll. The project detail
  follows the selection, and a selection made outside the chosen track falls
  back to that track's first project;
- one bottom-bar toggle that switches between the pipeline view and the results
  view, so only one of them is on screen at a time;
- a streaming run log in a floating panel opened from the bottom bar, a
  history drawer and a JSON report export;
- a single appearance menu in the header: theme pack, light, dark or **system**
  mode (automatic, follows the OS) and **rounded or square corners** applied to
  the whole interface, pills included;
- a globe **language selector** in the header, after the History button and
  kept compact with short codes only, with English, French, Mandarin
  Chinese and Hindi. The choice persists in `localStorage` and the
  `verdict-language` cookie, updates `<html lang>`, and defaults to English for
  the first server render so hydration stays stable;
- a run bar pinned to the bottom of the viewport, which stays there even when
  every section is collapsed;
- an installable PWA: a Workbox service worker caches the shell and an offline
  fallback page, and never caches API or SSE traffic;
- a pulsing dot on the tab favicon while a run is active, with the original
  icons restored once the run settles, so a long pipeline stays visible from
  another tab.

Model lists are not hardcoded. For every configured provider the API calls that
provider's model endpoint (`GET /v1/models`, Anthropic's `/v1/models`, Google's
`/v1beta/models` or Ollama's `/api/tags`), filters out non-chat models and caches
the result in memory. A model released after this code was written therefore
appears without a code change; `claude-haiku-5-5` is a current example. When an
endpoint fails, `<PROVIDER>_MODELS` is used as the fallback for that provider and
the Models section names the affected providers. Set `PROVIDER_MODELS_TTL_SECONDS`,
`PROVIDER_MODELS_ERROR_TTL_SECONDS` and `PROVIDER_MODELS_TIMEOUT_MS` to tune the
cache and the request timeout. `GET /providers?refresh=1` bypasses the cache.

Runs stream over SSE; reloading the page re-subscribes and replays every event.
A completed report is saved to IndexedDB automatically.

## API

| Route | Purpose |
| --- | --- |
| `GET /health` | liveness |
| `GET /providers` | configured providers, their discovered models (`?refresh=1` bypasses the cache), the env default evaluator/verifier pool and the agent personas (never a key) |
| `POST /parse/manifest` | parse and validate a manifest |
| `POST /parse/rubric` | parse a rubric |
| `POST /runs/preview` | dry parse for the upload preview |
| `POST /runs` | start a run |
| `GET /runs` | list in-memory runs |
| `GET /runs/:id` | snapshot: status, events, evidence, evaluations, report |
| `GET /runs/:id/report` | final report |
| `GET /runs/:id/events` | SSE stream, replaying recorded events first |
| `POST /runs/:id/cancel` | cancel a run |

Run state is in memory: restarting the API forgets runs. The browser keeps the
reports it has seen.

## Repository layout

| Path | Role |
| --- | --- |
| `apps/api` | Fastify + SSE, in-memory run store |
| `apps/web` | Next.js 16 single-screen workspace, PWA shell |
| `apps/web/sw` | Workbox template stamped into `public/sw.js` at build time |
| `apps/web/scripts/build-sw.ts` | Stamps the worker with the commit id |
| `packages/shared` | types, zod schemas, manifest and rubric parsers, consensus |
| `packages/providers` | provider registry and AI SDK model factory |
| `packages/harvest` | GitHub tarball and indexing, yt-dlp, frames, transcription |
| `packages/eval` | agents, dossiers, prompts, consensus, ranking, verifiers |
| `packages/ui` | shared UI kit |
| `packages/theme` | theme packs and chrome |

Every app and package is a Bun workspace driven by Turbo. Root commands fan out
through `turbo run`; run a single workspace from its directory with
`cd apps/web && bun run build`.

`AGENTS.md` at the repository root explains the architecture, the conventions
and the verification checklist for anyone, human or agent, taking over the code.

## Guarantees and limits

- The six evaluators are fixed agent roles; the configured model list is cycled
  across them. The same is true for the two verifiers.
- Evaluation input is untrusted: repository and video content is data, never
  instructions. The prompts say so explicitly.
- A harvest failure is recorded per project and never silently drops a project.
- Video is downloaded and sampled locally; native video is only sent to
  providers that accept it. Others receive the transcript and frame captions.
- Model calls are subject to the configured provider's own limits; a failed
  call is logged, and consensus proceeds with the remaining evaluations.

## License

[MIT](./LICENSE) © rouftom
