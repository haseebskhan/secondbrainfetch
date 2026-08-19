# Instagram → Notion Second Brain

A serverless pipeline that turns a shared Instagram/TikTok/YouTube link into a
transcribed, categorized, cross-linked page in a Notion database. Triggered
via an iOS Shortcut in the share sheet; runs on Vercel.

Full pipeline walkthrough: [docs/architecture.md](docs/architecture.md)
Deployment / Shortcut setup: [docs/SETUP.md](docs/SETUP.md)

## Keep documentation in sync

There are two documentation surfaces for this project, and both must be
updated whenever a **structural change** lands — a new pipeline step, a
changed file responsibility, a new/changed Notion property, a new category,
a changed deployment requirement, or anything else that would make the
existing docs describe the system incorrectly:

1. **This repo** — `CLAUDE.md` (this file) and `docs/architecture.md`. The
   technical reference, read by Claude Code at the start of every session
   here.
2. **Notion** — the "[Second Brain — How It Works](https://app.notion.com/p/3c13df2301d981dc8158fd95261db3ea)"
   page, nested under My Life OS next to the Second Brain database. The
   plain-language version for the human owner, including a change log at
   the bottom — append a dated entry there for any structural change,
   newest first.

A change that's small and cosmetic (copy tweaks, a comment, a test-only
refactor) doesn't need either doc touched. When in doubt, if the change
would surprise someone reading the current docs, update both.

## Quick orientation

- **Entry point:** [api/ingest.ts](api/ingest.ts) — the only HTTP endpoint.
  Validates the webhook secret and URL host, then fires `runPipeline` via
  `waitUntil` (Vercel Fluid Compute) and returns `202` immediately. The
  Shortcut never waits for the actual processing.
- **Orchestrator:** [src/pipeline.ts](src/pipeline.ts) — `runPipeline()`.
  Everything downstream of the webhook happens here. Read this file first
  when debugging or extending behavior.
- **Notion writing:** [src/notion.ts](src/notion.ts) — block builders
  (`markdownToBlocks`, `buildSummaryCallout`, `buildTranscriptToggle`) and
  `createNotionPage`.
- **Categories:** [src/categories.ts](src/categories.ts) — the fixed list of
  13 categories, normalization, and the category → Phosphor icon mapping.
  This is the single source of truth other modules key off of
  (`contentTemplates.ts`, `zettelkasten.ts`).

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm test             # vitest run
```

Run both before considering any change done — see
[docs/architecture.md#testing](docs/architecture.md#testing).

## Conventions this codebase follows

- **TDD.** Every `src/*.ts` module has a matching `tests/*.test.ts`. Tests
  mock external I/O (yt-dlp, ffmpeg, OpenAI, Anthropic, Notion) via
  dependency injection through `PipelineDeps` — see how `pipeline.test.ts`
  overrides `deps`.
- **Every external step in the pipeline is independently try/caught.** A
  transcription failure must not block frame extraction; a metadata fetch
  failure must not block the Notion write. When adding a new pipeline step,
  follow this pattern — see the comments throughout `runPipeline()`.
- **Degraded-write fallback.** If the full Notion write fails, the pipeline
  retries once with a minimal payload (title, source URL, error note) so a
  saved link is never silently dropped.
- **Categories are a closed set.** Don't let free-text categories leak in —
  everything routes through `normalizeCategory()`.

## Where things live

| Concern | File |
|---|---|
| Webhook auth (timing-safe secret compare) | `src/auth.ts` |
| yt-dlp download + metadata | `src/download.ts` |
| Audio extraction + Whisper transcription (always → English) | `src/transcribe.ts` |
| Video frame sampling for vision analysis | `src/vision.ts` |
| Title/summary/category/tags via Claude | `src/analyze.ts` |
| Category-specific note generation (recipe steps, trading steps, etc.) | `src/contentTemplates.ts` |
| Zettelkasten-style fallback notes (categories with no dedicated template) | `src/zettelkasten.ts` |
| Extracting a linked external site from the caption + fetching its text | `src/webfetch.ts` |
| "Mentioned tools/resources" extraction | `src/keyItems.ts` |
| Duplicate source-URL detection | `src/duplicates.ts` |
| Related-notes cross-linking (category + tag overlap) | `src/relatedNotes.ts` |
| Notion block/property builders + page creation | `src/notion.ts` |
| Shared types (`PipelineResult`, `AnalysisResult`, `Category`, ...) | `src/types.ts` |

## Environment variables

See `.env.example`. Set these in Vercel Project Settings, not locally
committed anywhere:

`WEBHOOK_SECRET`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `NOTION_TOKEN`,
`NOTION_DATABASE_ID`, `YT_DLP_PATH`.

## Gotchas worth knowing before touching this

- **Whisper calls go through raw `fetch`, not the OpenAI SDK.** The SDK's
  bundled node-fetch transport fails with `ECONNRESET` inside Vercel's
  sandbox. `src/transcribe.ts` POSTs directly to
  `/v1/audio/translations` (not `/transcriptions` — this is what forces
  English output regardless of spoken language).
- **`ffmpeg-static`'s resolved path, not the bare `ffmpeg` command** — it's
  not on `PATH` in the Vercel Node runtime.
- **Notion's page icon API only accepts an emoji or an external image URL**
  — never its built-in icon-picker library. Category icons are served as
  external SVGs from the Phosphor Icons jsDelivr CDN (see
  `getCategoryIconUrl` in `src/categories.ts`).
- **`YT_DLP_PATH` resolution uses `||`, not `??`** — an accidentally blank
  env var must fall back to the bundled binary path.
- **Claude JSON responses get fence-stripped** (` ```json ` wrapping) before
  `JSON.parse` in every module that asks Claude for structured output.
