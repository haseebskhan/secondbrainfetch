import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, rm, readFile } from "node:fs/promises";
import type { Client } from "@notionhq/client";
import type OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import ffmpegStaticPath from "ffmpeg-static";
import type { PipelineResult } from "./types.js";
import { buildPageProperties, createNotionPage, chunkText } from "./notion.js";
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

  // ffmpeg-static resolves to the bundled ffmpeg binary path; the bare
  // "ffmpeg" command is not on PATH in the Vercel Node runtime.
  const ffmpegPath = ffmpegStaticPath ?? "ffmpeg";

  // Namespace this invocation's working files under a unique directory so a
  // warm Lambda container never mixes files between unrelated/concurrent
  // requests.
  const invocationDir = path.join(os.tmpdir(), randomUUID());
  await mkdir(invocationDir, { recursive: true });

  let result: PipelineResult;

  try {
    try {
      const media = await downloadMedia(sourceUrl, { outDir: invocationDir });

      let transcript: string | null = null;
      let frames: Buffer[] = [];

      try {
        if (media.isVideo) {
          // Transcript and frame extraction are independent: a failure in
          // one (e.g. a Whisper API error) should not prevent the other
          // from being captured and used for analysis.
          try {
            transcript = await extractAndTranscribe(media.filePath, {
              openai: deps.openai,
              ffmpegPath,
              outDir: invocationDir,
            });
          } catch (transcribeErr) {
            console.error("Transcription failed:", transcribeErr);
          }

          try {
            frames = await extractFrames(media.filePath, {
              ffmpegPath,
              outDir: invocationDir,
            });
          } catch (framesErr) {
            console.error("Frame extraction failed:", framesErr);
          }
        } else {
          // Image posts have no audio/video to run ffmpeg against — read
          // the downloaded image itself so Claude has something to look at.
          frames = [await readFile(media.filePath)];
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
    ]
      .filter((p): p is string => Boolean(p))
      .flatMap((p) => chunkText(p));

    try {
      await writeNotionPage(deps.notionClient, deps.notionDatabaseId, properties, bodyParagraphs);
    } catch (writeErr) {
      // Never silently drop a saved link: if the full write fails (e.g. an
      // unexpected 400 from a malformed field), retry once with a minimal
      // degraded payload that is unlikely to fail the same way.
      const message = writeErr instanceof Error ? writeErr.message : String(writeErr);
      console.error("Notion write failed, retrying with a degraded payload:", message);

      const degradedProperties = buildPageProperties({
        title: result.title ?? sourceUrl,
        sourceUrl,
        category: "Other",
        tags: [],
        status: "Failed",
      });
      const degradedBody = [`Source: ${sourceUrl}`, `Notion write failed: ${message}`];

      // If this also throws, let it propagate — the outer .catch() in
      // api/ingest.ts logs it, and there's nothing more we can safely do.
      await writeNotionPage(deps.notionClient, deps.notionDatabaseId, degradedProperties, degradedBody);

      result = {
        ...result,
        status: "Failed",
        errorMessage: `Notion write failed: ${message}`,
      };
    }

    return result;
  } finally {
    await rm(invocationDir, { recursive: true, force: true }).catch(() => {});
  }
}
