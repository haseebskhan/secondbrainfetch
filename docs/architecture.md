# Architecture

## Overview

```
iOS Share Sheet
      │  (Shortcut: POST url + x-webhook-secret)
      ▼
api/ingest.ts  ── validates secret + URL host, returns 202 immediately
      │  waitUntil(...)              (Vercel Fluid Compute keeps running post-response)
      ▼
src/pipeline.ts  runPipeline()
      │
      ├─ 1. duplicate check (src/duplicates.ts)          — short-circuits if already saved
      ├─ 2. download media + metadata (src/download.ts)  — yt-dlp
      ├─ 3. extract external URL from caption + fetch it (src/webfetch.ts)
      ├─ 4. transcribe audio (src/transcribe.ts)          — ffmpeg + Whisper, independent of (5)
      ├─ 5. sample video frames (src/vision.ts)           — ffmpeg, independent of (4)
      ├─ 6. analyze: title/summary/category/tags (src/analyze.ts) — Claude, vision + transcript
      ├─ 7. category-specific content notes (src/contentTemplates.ts / zettelkasten.ts)
      ├─ 8. extract mentioned tools/resources (src/keyItems.ts)
      ├─ 9. find related notes by category+tag overlap (src/relatedNotes.ts)
      ├─ 10. embed title+summary, find semantic matches (src/embeddings.ts, src/relatedNotes.ts) — merged into (9)'s results
      └─ 11. write the Notion page (src/notion.ts)         — with degraded-payload retry on failure
```

Every step from 3–10 is wrapped in its own try/catch inside `runPipeline()`.
None of them can block the others, and a failure anywhere still results in
*some* page being written — worst case, one with just the source URL and an
error note. See the "Never lose a save" principle below.

## Request lifecycle in detail

### 1. Webhook (`api/ingest.ts`)

- Rejects non-POST, missing/invalid `x-webhook-secret` (timing-safe compare,
  `src/auth.ts`), and any URL whose host isn't `instagram.com`, `tiktok.com`,
  `youtube.com`, or `youtu.be`.
- Fires `runPipeline()` via `waitUntil()` and responds `202` immediately —
  the Shortcut in the share sheet doesn't wait around for transcription/API
  calls, it just gets a fast "accepted."
- Requires Vercel **Fluid Compute** enabled on the project; without it,
  `waitUntil` work is killed the moment the response is sent.

### 2. Duplicate check (`src/duplicates.ts`)

Queries Notion for an existing page with the same `Source URL` before doing
any downloading or spending any API calls. If found, the pipeline returns
early with `status: "Duplicate"` — no page is touched or created. A failure
in this check is treated as "not a duplicate" (fail open) rather than
blocking the save.

### 3. Download (`src/download.ts`)

Uses `yt-dlp` (bundled binary, path resolved via `YT_DLP_PATH`) to download
the media file and, best-effort, its JSON metadata (`-j` flag) for
title/caption/uploader. Metadata failures don't block the rest of the
pipeline.

### 4. External site fetch (`src/webfetch.ts`)

Many reels (especially recipes) link to a blog/site in the caption.
`extractExternalUrl` pulls that link out; `fetchWebpageText` fetches its
text opportunistically so recipe/step extraction has the full source
material, not just what's visible in the caption. Non-fatal on failure.

### 5–6. Transcription + frame sampling

- **Transcription** (`src/transcribe.ts`): extracts audio via ffmpeg, then
  POSTs it directly to OpenAI's `/v1/audio/translations` endpoint using raw
  `fetch` (not the OpenAI SDK — see Gotchas in `CLAUDE.md`). Using
  `/translations` rather than `/transcriptions` means output is **always
  English**, regardless of the spoken language.
- **Frames** (`src/vision.ts`): samples several frames from the video via
  ffmpeg for Claude's vision analysis in step 6. For image posts (no
  video), the downloaded image itself is used directly instead.

**Frame extraction is conditional, to avoid unnecessary Claude vision
cost.** Most reels convey everything needed for title/category/tags
through audio alone. `runPipeline()` only calls `extractFrames()` when the
transcript is missing or under `MIN_TRANSCRIPT_WORDS_FOR_VISION_SKIP` (50
words) — a silent or mostly-visual reel. A substantial transcript skips
frame sampling entirely, and `analyzeContent()` runs on transcript + caption
only, with an empty `frames` array. Image posts always get their single
image analyzed, since there's no transcript to fall back on. See
`wordCount()` and the threshold constant near the top of `src/pipeline.ts`
if this needs tuning.

### 7. Content analysis (`src/analyze.ts`)

Sends the transcript + sampled frames + caption to Claude, asking for:
`title` (always rewritten to be descriptive, not the reel's often-cryptic
original), `summary` (one short sentence for the page's top callout),
`category` (one of the 13 fixed categories), `tags`.

### 8. Category-specific content notes (`src/contentTemplates.ts`)

This is where the page gets its substance, dispatched by category:

| Category | Treatment |
|---|---|
| Recipes/Food | Ingredients list + numbered steps + notes |
| Trading, Claude Hacks, Parenting Hacks | Numbered step-by-step breakdown of the technique/tip |
| Design Hacks, Design Inspiration | "What They Did" + Claude's own "New Ideas & Trends" (deliberately generative, not just extractive) |
| Everything else | Zettelkasten-style notes (`src/zettelkasten.ts`) — requires a transcript |

### 9. Key items (`src/keyItems.ts`)

Pulls out any tools, apps, products, or resources explicitly mentioned, for
a "Mentioned Tools & Resources" section.

### 10. Related notes — tag-based and semantic (`src/relatedNotes.ts`, `src/embeddings.ts`)

Two independent sources feed the same `Related Notes` list:

- **Tag-based** (`findRelatedNotes`): existing pages sharing category and/or
  tags, ranked by tag overlap. Catches the "obvious" connections.
- **Semantic** (`findSemanticMatches`): `src/embeddings.ts` requests a
  256-dimension OpenAI embedding (`text-embedding-3-small`) for the new
  page's title+summary, then compares it by cosine similarity against every
  existing page's stored embedding, regardless of category or tags. Catches
  connections tag overlap can't — two pages from completely different
  categories making the same underlying point.

`mergeRelatedNotes` combines both (tag matches first, semantic matches
filling remaining slots, deduped by page id) into one list of
`{id, title, url}`, which becomes both a real Notion **relation** property
(`Related Notes`, with `Referenced By` as the reverse side) and a visible
"Related Notes" section at the bottom of the page. The new page's own
embedding is stored on it (`Embedding` property, JSON-encoded) so it's
available for *future* pages' semantic matching. A failure in the embedding
step doesn't block the write or the tag-based matches — the page is just
saved without its own embedding, and gets one on the next backfill run
(`scripts/backfill-embeddings.ts`).

### 11. Notion write (`src/notion.ts`)

`buildPageProperties` sets Title, Source URL, Category, Tags, Date Saved,
and (when present) Creator, External Source, Related Notes.
`buildPageBlocks` (in `pipeline.ts`) composes the body in this order:

1. Colored callout with the one-line summary (skipped if no summary)
2. Mentioned Tools & Resources + category-specific notes + Source/metadata
3. Raw transcript, collapsed into a toggle block (long, least scannable)
4. Related Notes, last — a "see also," not the point of the page

`createNotionPage` sets the page icon to an external Phosphor SVG matched to
the page's category (`getCategoryIconUrl` in `src/categories.ts`).

**Never lose a save:** if the full write throws (e.g. a malformed field),
the pipeline retries once with a minimal degraded payload — title, source
URL, and an error note — so a share never just vanishes.

## Notion database shape

Database: "Second Brain — Saved Reels". Properties:

- `Title` (title) — always Claude-rewritten, not the raw reel title
- `Source URL` (url)
- `Category` (select) — one of the 13 fixed values in `src/categories.ts`
- `Tags` (multi-select)
- `Date Saved` (date)
- `Creator` (rich text, optional)
- `External Source` (url, optional) — a linked blog/site found in the caption
- `Related Notes` (relation, self-referencing) / `Referenced By` (its
  reverse relation)
- `Embedding` (rich text, optional) — JSON-encoded 256-dim vector used only
  for semantic related-notes matching; not meant to be read by a human

## Testing

Every `src/*.ts` module has a matching test in `tests/`. External I/O
(yt-dlp, ffmpeg, OpenAI, Anthropic SDK calls, Notion client) is injected via
`PipelineDeps` in `pipeline.ts` and mocked in tests — nothing in the test
suite makes a real network call. Run:

```bash
npm run typecheck
npm test
```

Both before treating any change as complete.

## Deployment

Vercel, single serverless function (`api/ingest.ts`), `maxDuration: 300`
seconds and `includeFiles: "bin/**"` (the bundled `yt-dlp` binary) — set in
`vercel.json`. Full step-by-step deploy + iOS Shortcut setup:
[SETUP.md](SETUP.md).
