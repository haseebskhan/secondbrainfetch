# Instagram-to-Notion Second Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a webhook-driven pipeline that takes a shared Instagram reel/post link, downloads the media, transcribes audio, analyzes visuals, categorizes the content, and saves a structured record to a Notion database.

**Architecture:** An iOS Shortcut POSTs the shared URL to a Vercel serverless webhook (Node.js/TypeScript). The webhook validates a secret, then runs an async pipeline (`waitUntil`) that downloads media via a bundled `yt-dlp` binary, transcribes audio via OpenAI Whisper, analyzes frames/transcript via Claude vision, and writes the result to a Notion database via the Notion API. The webhook itself responds immediately (fire-and-forget).

**Tech Stack:** TypeScript, Node.js 20, Vercel serverless functions (`@vercel/functions` for `waitUntil`), `yt-dlp` (bundled static binary), `ffmpeg-static`, `openai` SDK (Whisper), `@anthropic-ai/sdk` (Claude vision + analysis), `@notionhq/client`, `vitest` for tests.

**Spec:** [docs/superpowers/specs/2026-08-18-instagram-to-notion-second-brain-design.md](../specs/2026-08-18-instagram-to-notion-second-brain-design.md)

## Global Constraints

- Single user, personal tool — one shared webhook secret, no multi-tenant auth.
- Fire-and-forget: the webhook must respond before the pipeline finishes.
- Every failure path must still create/update a Notion page (never silently drop a shared link) — Status = "Failed" or "Partial".
- Fixed category list (exact values): `Recipes/Food`, `Fitness/Health`, `Business/Ideas`, `Learning/Tech`, `Travel`, `Quotes/Inspiration`, `Entertainment/Humor`, `Other`.
- Secrets (OpenAI key, Anthropic key, Notion token, webhook secret) live only in environment variables, never committed.
- Full transcript/visual description goes in the Notion page body, not a property.

---

## File Structure

```
package.json
tsconfig.json
vercel.json
.env.example
.gitignore
scripts/download-yt-dlp.js
bin/                      (git-ignored; yt-dlp binary lands here at build time)
api/ingest.ts             (Vercel HTTP handler)
src/types.ts              (shared types)
src/auth.ts               (webhook secret validation)
src/categories.ts         (fixed category list + normalization)
src/download.ts           (yt-dlp wrapper)
src/transcribe.ts         (audio extraction + Whisper)
src/vision.ts             (frame extraction)
src/analyze.ts            (Claude analysis: title/summary/category/tags)
src/notion.ts             (Notion page property builder + create call)
src/pipeline.ts           (orchestrator)
tests/auth.test.ts
tests/categories.test.ts
tests/notion.test.ts
tests/download.test.ts
tests/transcribe.test.ts
tests/vision.test.ts
tests/analyze.test.ts
tests/pipeline.test.ts
docs/SETUP.md             (Notion DB + Shortcut + Vercel deploy instructions)
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vercel.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/types.ts`
- Create: `scripts/download-yt-dlp.js`
- Test: none (scaffolding only; verified by running `npm install` and `npm run typecheck`)

**Interfaces:**
- Produces: `Category`, `DownloadResult`, `AnalysisResult`, `PipelineStatus`, `PipelineResult` types used by every later task.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "instagram-to-notion",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "postinstall": "node scripts/download-yt-dlp.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "@notionhq/client": "^2.2.15",
    "@vercel/functions": "^1.5.0",
    "ffmpeg-static": "^5.2.0",
    "openai": "^4.68.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@vercel/node": "^3.2.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node", "vitest/globals"]
  },
  "include": ["api", "src", "tests", "scripts"]
}
```

- [ ] **Step 3: Create `vercel.json`**

```json
{
  "functions": {
    "api/ingest.ts": {
      "maxDuration": 300,
      "includeFiles": "bin/**"
    }
  }
}
```

- [ ] **Step 4: Create `.env.example`**

```
WEBHOOK_SECRET=replace-with-a-long-random-string
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
NOTION_TOKEN=secret_...
NOTION_DATABASE_ID=replace-with-database-id
YT_DLP_PATH=./bin/yt-dlp
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
bin/
.env
.vercel
```

- [ ] **Step 6: Create `src/types.ts`**

```typescript
export type Category =
  | "Recipes/Food"
  | "Fitness/Health"
  | "Business/Ideas"
  | "Learning/Tech"
  | "Travel"
  | "Quotes/Inspiration"
  | "Entertainment/Humor"
  | "Other";

export interface DownloadResult {
  filePath: string;
  isVideo: boolean;
}

export interface AnalysisResult {
  title: string;
  summary: string;
  category: Category;
  tags: string[];
}

export type PipelineStatus = "Done" | "Failed" | "Partial";

export interface PipelineResult {
  status: PipelineStatus;
  sourceUrl: string;
  title?: string;
  summary?: string;
  category?: Category;
  tags?: string[];
  transcript?: string | null;
  errorMessage?: string;
}
```

- [ ] **Step 7: Create `scripts/download-yt-dlp.js`**

Downloads the standalone Linux yt-dlp binary at install time so it can be bundled into the Vercel function via `includeFiles` in `vercel.json`.

```javascript
import { mkdirSync, writeFileSync, chmodSync, existsSync } from "node:fs";

const BIN_DIR = "bin";
const BIN_PATH = `${BIN_DIR}/yt-dlp`;
const URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

async function main() {
  if (existsSync(BIN_PATH)) return;
  mkdirSync(BIN_DIR, { recursive: true });
  const res = await fetch(URL);
  if (!res.ok) {
    throw new Error(`Failed to download yt-dlp: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(BIN_PATH, buf);
  chmodSync(BIN_PATH, 0o755);
}

main();
```

- [ ] **Step 8: Install and typecheck**

Run: `npm install && npm run typecheck`
Expected: installs cleanly, `bin/yt-dlp` exists, typecheck passes with no source files yet (only `types.ts`, which has no errors).

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vercel.json .env.example .gitignore src/types.ts scripts/download-yt-dlp.js package-lock.json
git commit -m "Scaffold project: package config, shared types, yt-dlp download script"
```

---

### Task 2: Webhook secret validation

**Files:**
- Create: `src/auth.ts`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Produces: `isValidWebhookSecret(provided: string | undefined | null, expected: string): boolean`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/auth.test.ts
import { describe, it, expect } from "vitest";
import { isValidWebhookSecret } from "../src/auth.js";

describe("isValidWebhookSecret", () => {
  it("returns true when provided matches expected", () => {
    expect(isValidWebhookSecret("abc123", "abc123")).toBe(true);
  });

  it("returns false when provided does not match", () => {
    expect(isValidWebhookSecret("wrong", "abc123")).toBe(false);
  });

  it("returns false when provided is undefined", () => {
    expect(isValidWebhookSecret(undefined, "abc123")).toBe(false);
  });

  it("returns false when provided is null", () => {
    expect(isValidWebhookSecret(null, "abc123")).toBe(false);
  });

  it("returns false when provided is empty string", () => {
    expect(isValidWebhookSecret("", "abc123")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth.test.ts`
Expected: FAIL — `src/auth.ts` does not exist / `isValidWebhookSecret` not defined.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/auth.ts
export function isValidWebhookSecret(
  provided: string | undefined | null,
  expected: string
): boolean {
  if (!provided) return false;
  return provided === expected;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auth.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts tests/auth.test.ts
git commit -m "Add webhook secret validation"
```

---

### Task 3: Fixed category list + normalization

**Files:**
- Create: `src/categories.ts`
- Test: `tests/categories.test.ts`

**Interfaces:**
- Consumes: `Category` from `src/types.ts`
- Produces: `CATEGORIES: readonly Category[]`, `normalizeCategory(value: string): Category`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/categories.test.ts
import { describe, it, expect } from "vitest";
import { CATEGORIES, normalizeCategory } from "../src/categories.js";

describe("CATEGORIES", () => {
  it("contains the 8 fixed categories in order", () => {
    expect(CATEGORIES).toEqual([
      "Recipes/Food",
      "Fitness/Health",
      "Business/Ideas",
      "Learning/Tech",
      "Travel",
      "Quotes/Inspiration",
      "Entertainment/Humor",
      "Other",
    ]);
  });
});

describe("normalizeCategory", () => {
  it("returns an exact match unchanged", () => {
    expect(normalizeCategory("Travel")).toBe("Travel");
  });

  it("matches case-insensitively", () => {
    expect(normalizeCategory("travel")).toBe("Travel");
  });

  it("falls back to Other for an unrecognized value", () => {
    expect(normalizeCategory("Cryptocurrency")).toBe("Other");
  });

  it("falls back to Other for an empty string", () => {
    expect(normalizeCategory("")).toBe("Other");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/categories.test.ts`
Expected: FAIL — `src/categories.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/categories.ts
import type { Category } from "./types.js";

export const CATEGORIES: readonly Category[] = [
  "Recipes/Food",
  "Fitness/Health",
  "Business/Ideas",
  "Learning/Tech",
  "Travel",
  "Quotes/Inspiration",
  "Entertainment/Humor",
  "Other",
];

export function normalizeCategory(value: string): Category {
  const match = CATEGORIES.find(
    (c) => c.toLowerCase() === value.trim().toLowerCase()
  );
  return match ?? "Other";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/categories.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/categories.ts tests/categories.test.ts
git commit -m "Add fixed category list and normalization"
```

---

### Task 4: Notion page property builder + create call

**Files:**
- Create: `src/notion.ts`
- Test: `tests/notion.test.ts`

**Interfaces:**
- Consumes: `Category`, `PipelineStatus` from `src/types.ts`
- Produces: `buildPageProperties(data: { title: string; sourceUrl: string; category: Category; tags: string[]; status: PipelineStatus }): Record<string, unknown>`, `createNotionPage(client: Client, databaseId: string, properties: Record<string, unknown>, bodyMarkdownParagraphs: string[]): Promise<string>` (returns created page id)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/notion.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildPageProperties, createNotionPage } from "../src/notion.js";

describe("buildPageProperties", () => {
  it("maps fields to Notion property shapes", () => {
    const props = buildPageProperties({
      title: "3-Ingredient Pasta",
      sourceUrl: "https://www.instagram.com/reel/abc123/",
      category: "Recipes/Food",
      tags: ["pasta", "quick meals"],
      status: "Done",
    });

    expect(props).toEqual({
      Title: { title: [{ text: { content: "3-Ingredient Pasta" } }] },
      "Source URL": { url: "https://www.instagram.com/reel/abc123/" },
      Category: { select: { name: "Recipes/Food" } },
      Tags: { multi_select: [{ name: "pasta" }, { name: "quick meals" }] },
      "Date Saved": { date: { start: expect.any(String) } },
      Status: { select: { name: "Done" } },
    });
  });
});

describe("createNotionPage", () => {
  it("calls pages.create with the database id, properties, and body paragraphs", async () => {
    const create = vi.fn().mockResolvedValue({ id: "page-123" });
    const fakeClient = { pages: { create } } as any;

    const pageId = await createNotionPage(
      fakeClient,
      "db-456",
      { Title: { title: [{ text: { content: "X" } }] } },
      ["Transcript: hello world", "Source: https://instagram.com/reel/abc"]
    );

    expect(pageId).toBe("page-123");
    expect(create).toHaveBeenCalledWith({
      parent: { database_id: "db-456" },
      properties: { Title: { title: [{ text: { content: "X" } }] } },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: "Transcript: hello world" } }] },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: "Source: https://instagram.com/reel/abc" } }] },
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notion.test.ts`
Expected: FAIL — `src/notion.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/notion.ts
import type { Client } from "@notionhq/client";
import type { Category, PipelineStatus } from "./types.js";

export function buildPageProperties(data: {
  title: string;
  sourceUrl: string;
  category: Category;
  tags: string[];
  status: PipelineStatus;
}): Record<string, unknown> {
  return {
    Title: { title: [{ text: { content: data.title } }] },
    "Source URL": { url: data.sourceUrl },
    Category: { select: { name: data.category } },
    Tags: { multi_select: data.tags.map((t) => ({ name: t })) },
    "Date Saved": { date: { start: new Date().toISOString() } },
    Status: { select: { name: data.status } },
  };
}

export async function createNotionPage(
  client: Client,
  databaseId: string,
  properties: Record<string, unknown>,
  bodyParagraphs: string[]
): Promise<string> {
  const response = await client.pages.create({
    parent: { database_id: databaseId },
    properties,
    children: bodyParagraphs.map((text) => ({
      object: "block" as const,
      type: "paragraph" as const,
      paragraph: { rich_text: [{ type: "text" as const, text: { content: text } }] },
    })),
  });
  return response.id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/notion.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/notion.ts tests/notion.test.ts
git commit -m "Add Notion page property builder and create call"
```

---

### Task 5: yt-dlp media download wrapper

**Files:**
- Create: `src/download.ts`
- Test: `tests/download.test.ts`

**Interfaces:**
- Consumes: `DownloadResult` from `src/types.ts`
- Produces: `downloadMedia(url: string, opts?: { ytDlpPath?: string; outDir?: string; exec?: typeof execFileAsync }): Promise<DownloadResult>`

Design note: `yt-dlp` is invoked with `--print after_move:filepath` so the wrapper knows the exact downloaded file path without guessing extensions. `isVideo` is derived from the file extension.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/download.test.ts
import { describe, it, expect, vi } from "vitest";
import { downloadMedia } from "../src/download.js";

describe("downloadMedia", () => {
  it("returns the printed file path and marks video files as video", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "/tmp/out/reel.mp4\n", stderr: "" });

    const result = await downloadMedia("https://www.instagram.com/reel/abc123/", {
      ytDlpPath: "/bin/yt-dlp",
      outDir: "/tmp/out",
      exec: exec as any,
    });

    expect(result).toEqual({ filePath: "/tmp/out/reel.mp4", isVideo: true });
    expect(exec).toHaveBeenCalledWith("/bin/yt-dlp", [
      "--no-playlist",
      "--print",
      "after_move:filepath",
      "-o",
      "/tmp/out/%(id)s.%(ext)s",
      "https://www.instagram.com/reel/abc123/",
    ]);
  });

  it("marks image files as non-video", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "/tmp/out/post.jpg\n", stderr: "" });

    const result = await downloadMedia("https://www.instagram.com/p/xyz789/", {
      ytDlpPath: "/bin/yt-dlp",
      outDir: "/tmp/out",
      exec: exec as any,
    });

    expect(result).toEqual({ filePath: "/tmp/out/post.jpg", isVideo: false });
  });

  it("throws a descriptive error when yt-dlp fails", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("exit code 1: unable to extract"));

    await expect(
      downloadMedia("https://www.instagram.com/reel/bad/", {
        ytDlpPath: "/bin/yt-dlp",
        outDir: "/tmp/out",
        exec: exec as any,
      })
    ).rejects.toThrow(/Failed to download media/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/download.test.ts`
Expected: FAIL — `src/download.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/download.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DownloadResult } from "./types.js";

const execFileAsync = promisify(execFile);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv"]);

export async function downloadMedia(
  url: string,
  opts: {
    ytDlpPath?: string;
    outDir?: string;
    exec?: typeof execFileAsync;
  } = {}
): Promise<DownloadResult> {
  const ytDlpPath = opts.ytDlpPath ?? process.env.YT_DLP_PATH ?? "yt-dlp";
  const outDir = opts.outDir ?? "/tmp";
  const exec = opts.exec ?? execFileAsync;

  let stdout: string;
  try {
    const result = await exec(ytDlpPath, [
      "--no-playlist",
      "--print",
      "after_move:filepath",
      "-o",
      `${outDir}/%(id)s.%(ext)s`,
      url,
    ]);
    stdout = result.stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to download media from ${url}: ${message}`);
  }

  const filePath = stdout.trim().split("\n").pop() ?? "";
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return { filePath, isVideo: VIDEO_EXTENSIONS.has(ext) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/download.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/download.ts tests/download.test.ts
git commit -m "Add yt-dlp media download wrapper"
```

---

### Task 6: Audio extraction + Whisper transcription

**Files:**
- Create: `src/transcribe.ts`
- Test: `tests/transcribe.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (takes a raw video file path)
- Produces: `extractAndTranscribe(videoPath: string, opts: { openai: OpenAI; ffmpegPath?: string; exec?: typeof execFileAsync; outDir?: string }): Promise<string | null>` — returns `null` (not a thrown error) when the source has no audio stream, so callers can distinguish "no audio" from "transcription failed".

- [ ] **Step 1: Write the failing test**

```typescript
// tests/transcribe.test.ts
import { describe, it, expect, vi } from "vitest";
import { extractAndTranscribe } from "../src/transcribe.js";

describe("extractAndTranscribe", () => {
  it("extracts audio with ffmpeg and returns the Whisper transcript", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const create = vi.fn().mockResolvedValue({ text: "hello from the reel" });
    const fakeOpenai = { audio: { transcriptions: { create } } } as any;

    const transcript = await extractAndTranscribe("/tmp/out/reel.mp4", {
      openai: fakeOpenai,
      ffmpegPath: "/bin/ffmpeg",
      exec: exec as any,
      outDir: "/tmp/out",
    });

    expect(transcript).toBe("hello from the reel");
    expect(exec).toHaveBeenCalledWith("/bin/ffmpeg", [
      "-y",
      "-i",
      "/tmp/out/reel.mp4",
      "-vn",
      "-acodec",
      "libmp3lame",
      "/tmp/out/reel.mp3",
    ]);
    expect(create).toHaveBeenCalled();
  });

  it("returns null when ffmpeg reports no audio stream", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("Stream map '0:a' matches no streams"));
    const fakeOpenai = { audio: { transcriptions: { create: vi.fn() } } } as any;

    const transcript = await extractAndTranscribe("/tmp/out/silent.mp4", {
      openai: fakeOpenai,
      ffmpegPath: "/bin/ffmpeg",
      exec: exec as any,
      outDir: "/tmp/out",
    });

    expect(transcript).toBeNull();
  });

  it("propagates other ffmpeg errors", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("disk full"));
    const fakeOpenai = { audio: { transcriptions: { create: vi.fn() } } } as any;

    await expect(
      extractAndTranscribe("/tmp/out/reel.mp4", {
        openai: fakeOpenai,
        ffmpegPath: "/bin/ffmpeg",
        exec: exec as any,
        outDir: "/tmp/out",
      })
    ).rejects.toThrow(/disk full/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/transcribe.test.ts`
Expected: FAIL — `src/transcribe.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/transcribe.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream } from "node:fs";
import type OpenAI from "openai";

const execFileAsync = promisify(execFile);

export async function extractAndTranscribe(
  videoPath: string,
  opts: {
    openai: OpenAI;
    ffmpegPath?: string;
    exec?: typeof execFileAsync;
    outDir?: string;
  }
): Promise<string | null> {
  const ffmpegPath = opts.ffmpegPath ?? "ffmpeg";
  const exec = opts.exec ?? execFileAsync;
  const outDir = opts.outDir ?? "/tmp";
  const audioPath = `${outDir}/${videoPath.split("/").pop()?.split(".")[0]}.mp3`;

  try {
    await exec(ffmpegPath, ["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", audioPath]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("matches no streams")) {
      return null;
    }
    throw err;
  }

  const transcription = await opts.openai.audio.transcriptions.create({
    file: createReadStream(audioPath) as any,
    model: "whisper-1",
  });
  return transcription.text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/transcribe.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/transcribe.ts tests/transcribe.test.ts
git commit -m "Add audio extraction and Whisper transcription"
```

---

### Task 7: Video frame extraction

**Files:**
- Create: `src/vision.ts`
- Test: `tests/vision.test.ts`

**Interfaces:**
- Produces: `extractFrames(videoPath: string, opts: { ffmpegPath?: string; exec?: typeof execFileAsync; outDir?: string; readFile?: typeof readFileFn; count?: number }): Promise<Buffer[]>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/vision.test.ts
import { describe, it, expect, vi } from "vitest";
import { extractFrames } from "../src/vision.js";

describe("extractFrames", () => {
  it("runs ffmpeg to extract N frames and reads them back as buffers", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const readFile = vi.fn().mockResolvedValue(Buffer.from("fake-jpg-bytes"));

    const frames = await extractFrames("/tmp/out/reel.mp4", {
      ffmpegPath: "/bin/ffmpeg",
      exec: exec as any,
      outDir: "/tmp/out",
      readFile: readFile as any,
      count: 3,
    });

    expect(exec).toHaveBeenCalledWith("/bin/ffmpeg", [
      "-y",
      "-i",
      "/tmp/out/reel.mp4",
      "-vf",
      "fps=1/2",
      "-frames:v",
      "3",
      "/tmp/out/frame-%02d.jpg",
    ]);
    expect(readFile).toHaveBeenCalledTimes(3);
    expect(readFile).toHaveBeenCalledWith("/tmp/out/frame-01.jpg");
    expect(readFile).toHaveBeenCalledWith("/tmp/out/frame-02.jpg");
    expect(readFile).toHaveBeenCalledWith("/tmp/out/frame-03.jpg");
    expect(frames).toHaveLength(3);
    expect(frames[0]).toBeInstanceOf(Buffer);
  });

  it("defaults to 3 frames when count is not given", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const readFile = vi.fn().mockResolvedValue(Buffer.from("x"));

    const frames = await extractFrames("/tmp/out/reel.mp4", {
      ffmpegPath: "/bin/ffmpeg",
      exec: exec as any,
      outDir: "/tmp/out",
      readFile: readFile as any,
    });

    expect(frames).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vision.test.ts`
Expected: FAIL — `src/vision.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/vision.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile as readFileFn } from "node:fs/promises";

const execFileAsync = promisify(execFile);

export async function extractFrames(
  videoPath: string,
  opts: {
    ffmpegPath?: string;
    exec?: typeof execFileAsync;
    outDir?: string;
    readFile?: typeof readFileFn;
    count?: number;
  } = {}
): Promise<Buffer[]> {
  const ffmpegPath = opts.ffmpegPath ?? "ffmpeg";
  const exec = opts.exec ?? execFileAsync;
  const outDir = opts.outDir ?? "/tmp";
  const readFile = opts.readFile ?? readFileFn;
  const count = opts.count ?? 3;

  await exec(ffmpegPath, [
    "-y",
    "-i",
    videoPath,
    "-vf",
    "fps=1/2",
    "-frames:v",
    String(count),
    `${outDir}/frame-%02d.jpg`,
  ]);

  const frames: Buffer[] = [];
  for (let i = 1; i <= count; i++) {
    const num = String(i).padStart(2, "0");
    frames.push(await readFile(`${outDir}/frame-${num}.jpg`));
  }
  return frames;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/vision.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/vision.ts tests/vision.test.ts
git commit -m "Add video frame extraction"
```

---

### Task 8: Claude analysis (title, summary, category, tags)

**Files:**
- Create: `src/analyze.ts`
- Test: `tests/analyze.test.ts`

**Interfaces:**
- Consumes: `AnalysisResult`, `Category` from `src/types.ts`; `CATEGORIES`, `normalizeCategory` from `src/categories.ts`
- Produces: `analyzeContent(input: { transcript: string | null; frames: Buffer[] }, opts: { anthropic: Anthropic }): Promise<AnalysisResult>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/analyze.test.ts
import { describe, it, expect, vi } from "vitest";
import { analyzeContent } from "../src/analyze.js";

describe("analyzeContent", () => {
  it("parses Claude's JSON response into an AnalysisResult", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            title: "3-Ingredient Pasta",
            summary: "A quick weeknight pasta using pantry staples.",
            category: "Recipes/Food",
            tags: ["pasta", "quick meals"],
          }),
        },
      ],
    });
    const fakeAnthropic = { messages: { create } } as any;

    const result = await analyzeContent(
      { transcript: "today we're making pasta", frames: [Buffer.from("img")] },
      { anthropic: fakeAnthropic }
    );

    expect(result).toEqual({
      title: "3-Ingredient Pasta",
      summary: "A quick weeknight pasta using pantry staples.",
      category: "Recipes/Food",
      tags: ["pasta", "quick meals"],
    });
  });

  it("normalizes a category Claude returns outside the fixed list to Other", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            title: "Random Clip",
            summary: "Unclear content.",
            category: "Cryptocurrency",
            tags: [],
          }),
        },
      ],
    });
    const fakeAnthropic = { messages: { create } } as any;

    const result = await analyzeContent(
      { transcript: null, frames: [] },
      { anthropic: fakeAnthropic }
    );

    expect(result.category).toBe("Other");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analyze.test.ts`
Expected: FAIL — `src/analyze.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/analyze.ts
import type Anthropic from "@anthropic-ai/sdk";
import type { AnalysisResult } from "./types.js";
import { CATEGORIES, normalizeCategory } from "./categories.js";

export async function analyzeContent(
  input: { transcript: string | null; frames: Buffer[] },
  opts: { anthropic: Anthropic }
): Promise<AnalysisResult> {
  const imageBlocks = input.frames.map((frame) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/jpeg" as const,
      data: frame.toString("base64"),
    },
  }));

  const prompt = [
    `You are cataloging a saved Instagram reel/post for a personal knowledge base.`,
    `Transcript: ${input.transcript ?? "(no audio / not available)"}`,
    `Pick "category" from exactly this list: ${CATEGORIES.join(", ")}.`,
    `Respond with ONLY a JSON object: { "title": string, "summary": string, "category": string, "tags": string[] }.`,
    `"title" is a short descriptive title. "summary" is 1-2 sentences. "tags" is 2-5 free-form lowercase keywords.`,
  ].join("\n");

  const response = await opts.anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [...imageBlocks, { type: "text", text: prompt }],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude response did not contain a text block");
  }

  const parsed = JSON.parse(textBlock.text);
  return {
    title: parsed.title,
    summary: parsed.summary,
    category: normalizeCategory(parsed.category),
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analyze.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/analyze.ts tests/analyze.test.ts
git commit -m "Add Claude-based content analysis and categorization"
```

---

### Task 9: Pipeline orchestrator

**Files:**
- Create: `src/pipeline.ts`
- Test: `tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `downloadMedia` (Task 5), `extractAndTranscribe` (Task 6), `extractFrames` (Task 7), `analyzeContent` (Task 8), `buildPageProperties`/`createNotionPage` (Task 4), `PipelineResult` (Task 1)
- Produces: `runPipeline(sourceUrl: string, deps: PipelineDeps): Promise<PipelineResult>` — the single entry point the HTTP handler calls.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/pipeline.test.ts
import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "../src/pipeline.js";

function baseDeps(overrides: Partial<Record<string, any>> = {}) {
  return {
    downloadMedia: vi.fn().mockResolvedValue({ filePath: "/tmp/out/reel.mp4", isVideo: true }),
    extractAndTranscribe: vi.fn().mockResolvedValue("today we're making pasta"),
    extractFrames: vi.fn().mockResolvedValue([Buffer.from("img")]),
    analyzeContent: vi.fn().mockResolvedValue({
      title: "3-Ingredient Pasta",
      summary: "A quick pasta recipe.",
      category: "Recipes/Food",
      tags: ["pasta"],
    }),
    createNotionPage: vi.fn().mockResolvedValue("page-1"),
    notionClient: {} as any,
    notionDatabaseId: "db-1",
    openai: {} as any,
    anthropic: {} as any,
    ...overrides,
  };
}

describe("runPipeline", () => {
  it("returns Done status and writes a Notion page on full success", async () => {
    const deps = baseDeps();

    const result = await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(result.status).toBe("Done");
    expect(result.category).toBe("Recipes/Food");
    expect(deps.createNotionPage).toHaveBeenCalledTimes(1);
  });

  it("skips transcription and frame analysis for image posts", async () => {
    const deps = baseDeps({
      downloadMedia: vi.fn().mockResolvedValue({ filePath: "/tmp/out/post.jpg", isVideo: false }),
    });

    const result = await runPipeline("https://www.instagram.com/p/xyz/", deps as any);

    expect(deps.extractAndTranscribe).not.toHaveBeenCalled();
    expect(result.status).toBe("Done");
  });

  it("still writes a Failed Notion page when download fails", async () => {
    const deps = baseDeps({
      downloadMedia: vi.fn().mockRejectedValue(new Error("private account")),
    });

    const result = await runPipeline("https://www.instagram.com/reel/bad/", deps as any);

    expect(result.status).toBe("Failed");
    expect(result.errorMessage).toMatch(/private account/);
    expect(deps.createNotionPage).toHaveBeenCalledTimes(1);
  });

  it("marks Partial when analysis fails after a successful download", async () => {
    const deps = baseDeps({
      analyzeContent: vi.fn().mockRejectedValue(new Error("Claude timeout")),
    });

    const result = await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(result.status).toBe("Partial");
    expect(deps.createNotionPage).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: FAIL — `src/pipeline.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/pipeline.ts
import type { Client } from "@notionhq/client";
import type OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import type { PipelineResult } from "./types.js";
import { buildPageProperties, createNotionPage } from "./notion.js";
import { downloadMedia as downloadMediaFn } from "./download.js";
import { extractAndTranscribe as extractAndTranscribeFn } from "./transcribe.js";
import { extractFrames as extractFramesFn } from "./vision.js";
import { analyzeContent as analyzeContentFn } from "./analyze.js";

export interface PipelineDeps {
  downloadMedia?: typeof downloadMediaFn;
  extractAndTranscribe?: typeof extractAndTranscribeFn;
  extractFrames?: typeof extractFramesFn;
  analyzeContent?: typeof analyzeContentFn;
  createNotionPage?: typeof createNotionPage;
  notionClient: Client;
  notionDatabaseId: string;
  openai: OpenAI;
  anthropic: Anthropic;
}

export async function runPipeline(sourceUrl: string, deps: PipelineDeps): Promise<PipelineResult> {
  const downloadMedia = deps.downloadMedia ?? downloadMediaFn;
  const extractAndTranscribe = deps.extractAndTranscribe ?? extractAndTranscribeFn;
  const extractFrames = deps.extractFrames ?? extractFramesFn;
  const analyzeContent = deps.analyzeContent ?? analyzeContentFn;
  const writeNotionPage = deps.createNotionPage ?? createNotionPage;

  let result: PipelineResult;

  try {
    const media = await downloadMedia(sourceUrl);

    let transcript: string | null = null;
    let frames: Buffer[] = [];

    try {
      if (media.isVideo) {
        transcript = await extractAndTranscribe(media.filePath, { openai: deps.openai });
        frames = await extractFrames(media.filePath);
      }

      const analysis = await analyzeContent({ transcript, frames }, { anthropic: deps.anthropic });

      result = {
        status: "Done",
        sourceUrl,
        title: analysis.title,
        summary: analysis.summary,
        category: analysis.category,
        tags: analysis.tags,
        transcript,
      };
    } catch (analysisErr) {
      const message = analysisErr instanceof Error ? analysisErr.message : String(analysisErr);
      result = {
        status: "Partial",
        sourceUrl,
        transcript,
        errorMessage: message,
      };
    }
  } catch (downloadErr) {
    const message = downloadErr instanceof Error ? downloadErr.message : String(downloadErr);
    result = {
      status: "Failed",
      sourceUrl,
      errorMessage: message,
    };
  }

  const properties = buildPageProperties({
    title: result.title ?? sourceUrl,
    sourceUrl: result.sourceUrl,
    category: result.category ?? "Other",
    tags: result.tags ?? [],
    status: result.status,
  });

  const bodyParagraphs = [
    `Source: ${result.sourceUrl}`,
    result.summary ? `Summary: ${result.summary}` : undefined,
    result.transcript ? `Transcript: ${result.transcript}` : undefined,
    result.errorMessage ? `Error: ${result.errorMessage}` : undefined,
  ].filter((p): p is string => Boolean(p));

  await writeNotionPage(deps.notionClient, deps.notionDatabaseId, properties, bodyParagraphs);

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.ts tests/pipeline.test.ts
git commit -m "Add pipeline orchestrator with Failed/Partial/Done status handling"
```

---

### Task 10: HTTP webhook handler

**Files:**
- Create: `api/ingest.ts`
- Test: none (thin adapter over already-tested `isValidWebhookSecret` and `runPipeline`; verified manually in Task 13 against a deployed instance)

**Interfaces:**
- Consumes: `isValidWebhookSecret` (Task 2), `runPipeline` (Task 9)

- [ ] **Step 1: Write `api/ingest.ts`**

```typescript
// api/ingest.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import { Client } from "@notionhq/client";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { isValidWebhookSecret } from "../src/auth.js";
import { runPipeline } from "../src/pipeline.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = req.headers["x-webhook-secret"];
  if (!isValidWebhookSecret(Array.isArray(secret) ? secret[0] : secret, process.env.WEBHOOK_SECRET ?? "")) {
    res.status(401).json({ error: "Invalid webhook secret" });
    return;
  }

  const url = (req.body as { url?: string } | undefined)?.url;
  if (!url || typeof url !== "string" || !url.includes("instagram.com")) {
    res.status(400).json({ error: "Missing or invalid 'url' field" });
    return;
  }

  const notionClient = new Client({ auth: process.env.NOTION_TOKEN });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const notionDatabaseId = process.env.NOTION_DATABASE_ID ?? "";

  waitUntil(
    runPipeline(url, { notionClient, notionDatabaseId, openai, anthropic }).catch((err) => {
      console.error("Pipeline failed unexpectedly:", err);
    })
  );

  res.status(202).json({ status: "accepted" });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add api/ingest.ts
git commit -m "Add webhook HTTP handler wiring auth and pipeline"
```

---

### Task 11: Create the Notion database

This task uses the Notion MCP tools already connected in this Claude session — no code is written. The executor (Claude, in an interactive session with Notion access) does this directly:

- [ ] **Step 1: Ask the user which parent Notion page the new database should live under** (e.g. an existing "Second Brain" workspace page), using `notion-search` or `notion-list-recent-pages` to help them pick if needed.

- [ ] **Step 2: Create the database** with `notion-create-database` under the chosen parent, named `Second Brain — Saved Reels`, with this schema (matches `src/notion.ts` property names exactly):
  - `Title` — title
  - `Source URL` — url
  - `Category` — select, options: Recipes/Food, Fitness/Health, Business/Ideas, Learning/Tech, Travel, Quotes/Inspiration, Entertainment/Humor, Other
  - `Tags` — multi_select (no preset options; created dynamically)
  - `Date Saved` — date
  - `Status` — select, options: Done, Failed, Partial

- [ ] **Step 3: Share the database with the Notion integration** the backend will use (the same integration whose token becomes `NOTION_TOKEN`), via Notion's UI ("Connections" on the page) — MCP tools cannot grant integration access themselves, so tell the user to do this in the Notion app if it isn't already shared.

- [ ] **Step 4: Record the database ID** (from the URL or `notion-fetch` response) — this becomes the `NOTION_DATABASE_ID` env var in Task 12.

- [ ] **Step 5: No commit** (this task only creates external Notion state, nothing in the repo changes).

---

### Task 12: Deployment + iOS Shortcut setup guide

**Files:**
- Create: `docs/SETUP.md`

- [ ] **Step 1: Write `docs/SETUP.md`**

```markdown
# Setup Guide

## 1. Notion integration token

1. Go to https://www.notion.so/my-integrations and create a new internal integration.
2. Copy its "Internal Integration Token" — this is `NOTION_TOKEN`.
3. Share the "Second Brain — Saved Reels" database (created in Task 11) with this integration: open the database in Notion, click "..." → "Connections" → add the integration.

## 2. Deploy to Vercel

1. Push this repo to GitHub.
2. In the Vercel dashboard, import the repo as a new project.
3. Under Project Settings → Environment Variables, add:
   - `WEBHOOK_SECRET` — generate one with `openssl rand -hex 32`
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `NOTION_TOKEN`
   - `NOTION_DATABASE_ID`
4. Under Project Settings → Functions, enable **Fluid Compute** (required for `waitUntil` to keep running after the response is sent).
5. Deploy. Note the deployed URL, e.g. `https://your-project.vercel.app`.
6. Your webhook endpoint is `https://your-project.vercel.app/api/ingest`.

## 3. Create the iOS Shortcut

1. Open the Shortcuts app → "+" to create a new shortcut.
2. Add action **"Get Contents of URL"**:
   - URL: `https://your-project.vercel.app/api/ingest`
   - Method: `POST`
   - Headers: `x-webhook-secret` = (the `WEBHOOK_SECRET` value from step 2.3)
   - Request Body: JSON, with key `url` set to **Shortcut Input**
3. Add action **"Show Notification"** with text "Saved!" after the URL action (the shortcut does not need to wait for the webhook body — a 202 response returns almost immediately).
4. In the shortcut's settings (the "i" icon), enable **"Show in Share Sheet"** and restrict input types to **URLs**.
5. Name it (e.g. "Save to Second Brain").

## 4. Test it

From Instagram, open any reel or post → Share → find your shortcut in the share sheet → tap it. You should see a "Saved!" notification within a couple of seconds, and a new page should appear in the Notion database within about a minute.
```

- [ ] **Step 2: Commit**

```bash
git add docs/SETUP.md
git commit -m "Add deployment and iOS Shortcut setup guide"
```

---

### Task 13: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: all tests across `tests/auth.test.ts`, `tests/categories.test.ts`, `tests/notion.test.ts`, `tests/download.test.ts`, `tests/transcribe.test.ts`, `tests/vision.test.ts`, `tests/analyze.test.ts`, `tests/pipeline.test.ts` pass.

- [ ] **Step 2: Deploy and configure per `docs/SETUP.md`**

Follow Task 12's guide end-to-end: set env vars, enable Fluid Compute, deploy, create the Shortcut.

- [ ] **Step 3: Share a real public Instagram reel via the Shortcut**

Trigger from the iOS share sheet on an actual reel. Confirm the "Saved!" notification appears within a few seconds.

- [ ] **Step 4: Verify the Notion page**

Within ~60 seconds, check the "Second Brain — Saved Reels" database for a new page with Status = "Done", a sensible Title/Category/Tags, and the transcript in the body.

- [ ] **Step 5: Verify a failure path**

Share a link to a private or deleted post. Confirm a Notion page is still created with Status = "Failed" and an error message in the body, rather than nothing happening.

- [ ] **Step 6: Verify Claude retrieval**

In a Claude conversation with Notion access, ask a question whose answer lives only in a saved reel (e.g. "what was that pasta recipe I saved?"). Confirm Claude finds and uses it via Notion search.

- [ ] **Step 7: Commit any fixes found during verification**

If any step above surfaces a bug, fix it, re-run `npm test`, and commit with a message describing the fix.
