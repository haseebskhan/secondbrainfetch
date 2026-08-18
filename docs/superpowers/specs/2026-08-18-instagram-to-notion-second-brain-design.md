# Instagram-to-Notion Second Brain — Design

Date: 2026-08-18

## Purpose

Let the user share an Instagram reel or post directly from the iOS Share
Sheet. A backend pipeline downloads the media, transcribes the audio,
analyzes the visuals, categorizes the content, and saves a structured
record into a Notion database. That Notion database then acts as a
"second brain" — a growing, categorized archive that Claude can search
and reference in future conversations via the Notion MCP tools already
available to Claude sessions.

## Scope

Single user (personal tool), Instagram reels and posts (video and
image/carousel), iOS only for the share entry point. Not building a
multi-user product, not building a native app, not handling other
social platforms in this iteration.

## Architecture & Flow

```
iPhone Share Sheet
   -> iOS Shortcut (extracts IG URL, POSTs to webhook with a secret
      token, returns "Saved!" immediately — fire-and-forget)
   -> Serverless function (Cloudflare Worker / Vercel function)
       1. Validate webhook secret
       2. yt-dlp downloads the video (or image, for posts) from the
          IG link
       3. Extract audio -> OpenAI Whisper API -> transcript
          (skipped for image-only posts)
       4. Sample a few frames from the video (or use the image
          directly) -> Claude (vision) analyzes frames + transcript
          together
       5. Claude produces: title, 1-2 sentence summary, category
          (from a fixed list), tags
       6. Write a new page to a Notion database via the Notion API —
          structured properties + full transcript/visual description
          in the page body
   -> Notion database ("Second Brain — Saved Reels")
   -> Later: user asks Claude a question; Claude uses Notion
      search/fetch tools to pull relevant saved items and answer from
      them
```

Processing is fire-and-forget: the Shortcut does not wait on download,
transcription, or the Notion write. It sends the link and returns
control to the user immediately.

## Components

### 1. iOS Shortcut

- Triggered from the Share Sheet on an Instagram reel/post.
- Extracts the shared URL.
- POSTs `{ url }` to the backend webhook, with the webhook secret in a
  header.
- Does not wait for a response body beyond acknowledging the request
  was accepted; shows a quick local "Saved!" notification.

### 2. Backend webhook (serverless function)

- Public HTTPS endpoint. Rejects any request missing/mismatching the
  webhook secret.
- On a valid request, kicks off asynchronous processing (platform's
  background/queue mechanism, chosen at implementation time to fit
  timeout constraints — video download + transcription can take
  10-60+ seconds).
- Downloads media via **yt-dlp**.
- Extracts audio and sends to **OpenAI Whisper API** for
  transcription. Skipped for image-only posts.
- Sends sampled video frames (or the image, for image posts) plus the
  transcript to **Claude (vision)** for analysis.
- Claude's output: title, 1-2 sentence summary, category (must be one
  of the fixed list below), tags (free-form, AI-suggested).
- Writes the result to Notion via the Notion API.

### 3. Notion database — "Second Brain — Saved Reels"

Properties:

| Property | Type | Notes |
|---|---|---|
| Title | Title | AI-generated short title |
| Source URL | URL | Original Instagram link |
| Category | Select | Fixed list (below) |
| Tags | Multi-select | Free-form, AI-suggested |
| Summary | Text | 1-2 sentence AI summary |
| Date Saved | Date | Auto-set on ingest |
| Status | Select | Processing / Done / Failed / Partial |

Full transcript and visual description go in the **page body** (not a
property), with the Source URL and a thumbnail (if easily obtainable)
at the top, so content stays readable and searchable as normal Notion
text.

Fixed starter category list (editable later directly in Notion):
- Recipes/Food
- Fitness/Health
- Business/Ideas
- Learning/Tech
- Travel
- Quotes/Inspiration
- Entertainment/Humor
- Other

### 4. Retrieval / "second brain" usage

No separate retrieval component is built. Claude sessions already have
Notion MCP tools (`notion-search`, `notion-fetch`, etc.) available. The
user asks Claude a question in a normal conversation; Claude searches
the "Second Brain — Saved Reels" database (and any other connected
Notion content) like any other Notion page, and answers from what it
finds.

## Error Handling

- **yt-dlp download failure** (private account, deleted post, IG
  blocking the request): still create the Notion page, with
  Status = "Failed", the Source URL, and an error note in the body.
  The link is never silently dropped.
- **Whisper/Claude API errors or timeouts**: save whatever succeeded;
  mark Status = "Failed" or "Partial" depending on how much of the
  pipeline completed.
- **Image-only posts** (no audio track): skip the Whisper step
  entirely; run Claude vision on the image(s) only.
- **Serverless timeout limits**: the implementation should pick a
  runtime/platform with either a generous timeout or a
  background/queue execution model, since download + transcription can
  run past typical short serverless limits. This is a build-time
  decision, not a design blocker.

## Secrets & Configuration

- OpenAI API key, Anthropic API key, Notion integration token, and the
  webhook secret are stored as environment variables on the serverless
  platform — never committed to the repo.
- The Shortcut stores the webhook URL and secret locally on the user's
  phone.

## Out of Scope (this iteration)

- Multi-user support / auth beyond a single shared secret.
- Android or other platforms.
- Other social platforms (TikTok, YouTube, etc.).
- A dedicated retrieval UI — retrieval is entirely through Claude
  conversing over the existing Notion MCP tools.
- Automatic retries for failed processing (failures are recorded, not
  auto-retried).
