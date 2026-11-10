# verdict

Evidence-grounded, multi-agent evaluation of hackathon-style projects.

Upload a manifest of projects, the rules, and a rubric. `verdict` harvests each
project's GitHub repository and demo video, then runs:

1. **6 evaluator agents** — each scores the *same* weighted criteria
   independently.
2. **1 cross-review round** — every agent sees the other five, anonymised, and
   may revise with a written justification.
3. **Consensus** — trimmed mean per criterion, spread, and MAD dispersion.
4. **Comparative ranking** — one ordinal pass per track, aggregated by Borda
   count. Ranking is always produced, even with a single project.
5. **2 verifier agents** — audit the six evaluations, then reconcile final
   criterion scores and the per-track ranking.
6. **Report** — final scores, ranking, supplied-rank delta, evidence errors,
   token usage.

No authentication, no database. Run snapshots and the last workspace
configuration live in the browser's IndexedDB.

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

If that fails while the system interpreter has it — for example `python3` is a
`/usr/local/bin/python3` built without zlib, but `/usr/bin/python3` works — run
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

# providers — set the key(s) you have
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

# models shown in the UI (comma list or JSON array); empty = sensible defaults
META_MODELS=
OPENAI_MODELS=
ANTHROPIC_MODELS=
GOOGLE_MODELS=
XAI_MODELS=
RUNWARE_MODELS=           # AIR ids, e.g. google:gemini@4-argon,deepseek:v4.1@flash-1017
GROQ_MODELS=
DEEPSEEK_MODELS=
NEBIUS_MODELS=
NVIDIA_MODELS=
OLLAMA_MODELS=

# agent defaults (comma list of provider:model); empty = cycle every configured model
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

Each slot has a searchable model select — models are grouped by provider — and
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
| Manifest | JSON, YAML | Array, `{ projects: [] }`, or a single object. Fields: `name`, `track`, `github`/`repo`, `youtube`/`video`, `rank`, `description`, `team`. |
| Evaluation rules | Markdown, TXT | Passed verbatim to every agent as untrusted context. Optional. |
| Rubric | YAML, JSON, Markdown table | Optional; the built-in neutral rubric is used when empty. |

Example inputs ship inside the repository, so the preset buttons work out of
the box:

- `apps/web/public/rules/judging-rubric.generic.yaml` / `.md` — neutral rubric,
  same weights as the organiser rubric (Impact 30%, Use of AI Tooling 25%,
  Technical Depth & Execution 20%, Demo 25%).
- `apps/web/public/rules/meta-ai-developer-hackathon.md` — example rules
  upload.
- `apps/web/public/samples/winners.json` — example manifest with per-track
  ranks.

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
  in `winners.json` restart at 1 in each track.
- Up to three projects can be selected as calibration anchors. Anchors are
  ranked normally, get no bonus, and may come from another track (their
  dossier is passed to the ranking pass as calibration only).

## Workspace

The single screen has:

- an inputs column (manifest, rules, rubric, presets);
- a live preview (project count, criteria and weights, warnings, anchors);
- six evaluator slots and two verifier slots;
- options (ranks, video cap, temperature);
- a React Flow pipeline graph (harvest → evaluate → review → consensus → rank
  → verify → report);
- a per-track ranking with a project detail table (consensus, spread, final
  scores, evaluator matrix, verifier adjustments, harvest errors);
- a streaming run log, history drawer, JSON report export.

Runs stream over SSE; reloading the page re-subscribes and replays every event.
A completed report is saved to IndexedDB automatically.

## API

| Route | Purpose |
| --- | --- |
| `GET /health` | liveness |
| `GET /providers` | configured providers, models and the env default evaluator/verifier pool (never a key) |
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

```
verdict
├── apps/api        Fastify + SSE, in-memory run store
├── apps/web        Next.js 16 single-screen workspace
├── packages/shared types, zod schemas, manifest + rubric parsers, consensus
├── packages/providers provider registry + AI SDK model factory
├── packages/harvest   GitHub tarball/indexing, yt-dlp, frames, transcription
├── packages/eval      agents, dossiers, prompts, consensus, ranking, verifiers
├── packages/ui        shared UI kit
└── packages/theme     theme packs and chrome
```

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
