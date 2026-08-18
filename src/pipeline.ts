import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, rm, readFile } from "node:fs/promises";
import type { Client } from "@notionhq/client";
import type OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import ffmpegStaticPath from "ffmpeg-static";
import type { PipelineResult } from "./types.js";
import { buildPageProperties, createNotionPage, markdownToBlocks } from "./notion.js";
import { downloadMedia as downloadMediaFn, fetchMetadata as fetchMetadataFn } from "./download.js";
import { extractAndTranscribe as extractAndTranscribeFn } from "./transcribe.js";
import { extractFrames as extractFramesFn } from "./vision.js";
import { analyzeContent as analyzeContentFn } from "./analyze.js";
import { buildZettelkastenNotes as buildZettelkastenNotesFn } from "./zettelkasten.js";

const TITLE_MAX_LEN = 200;

export interface PipelineDeps {
  downloadMedia?: typeof downloadMediaFn;
  fetchMetadata?: typeof fetchMetadataFn;
  extractAndTranscribe?: typeof extractAndTranscribeFn;
  extractFrames?: typeof extractFramesFn;
  analyzeContent?: typeof analyzeContentFn;
  buildZettelkastenNotes?: typeof buildZettelkastenNotesFn;
  createNotionPage?: typeof createNotionPage;
  notionClient: Client;
  notionDatabaseId: string;
  openai: OpenAI;
  anthropic: Anthropic;
}

function truncateTitle(title: string): string {
  return title.length > TITLE_MAX_LEN ? `${title.slice(0, TITLE_MAX_LEN - 1)}…` : title;
}

/**
 * Composes the full page body as a constrained markdown document (headings,
 * label lines, plain paragraphs) that markdownToBlocks() converts into
 * proper Notion blocks — Source and metadata first, then the Zettelkasten
 * notes and visual description, with the raw transcript at the end.
 */
function buildBodyMarkdown(result: PipelineResult): string {
  const sections: string[] = [];

  sections.push(
    [
      "## Source",
      `URL: ${result.sourceUrl}`,
      result.uploader ? `Creator: ${result.uploader}` : undefined,
      result.reelDescription ? `Caption: ${result.reelDescription}` : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  );

  if (result.zettelkastenNotes) {
    sections.push(`## Zettelkasten Notes\n${result.zettelkastenNotes}`);
  }

  if (result.visualDescription) {
    sections.push(`## Visual Description\n${result.visualDescription}`);
  }

  if (result.errorMessage) {
    sections.push(`## Error\n${result.errorMessage}`);
  }

  sections.push(`## Raw Transcript\n${result.transcript ?? "No transcript available."}`);

  return sections.join("\n\n");
}

export async function runPipeline(sourceUrl: string, deps: PipelineDeps): Promise<PipelineResult> {
  const downloadMedia = deps.downloadMedia ?? downloadMediaFn;
  const fetchMetadata = deps.fetchMetadata ?? fetchMetadataFn;
  const extractAndTranscribe = deps.extractAndTranscribe ?? extractAndTranscribeFn;
  const extractFrames = deps.extractFrames ?? extractFramesFn;
  const analyzeContent = deps.analyzeContent ?? analyzeContentFn;
  const buildZettelkastenNotes = deps.buildZettelkastenNotes ?? buildZettelkastenNotesFn;
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

      // Metadata (title/caption/uploader) is a nice-to-have, not required
      // for the pipeline to succeed — a failure here shouldn't block
      // analysis or the Notion write.
      let reelTitle = "";
      let reelDescription = "";
      let uploader = "";
      try {
        const metadata = await fetchMetadata(sourceUrl);
        reelTitle = metadata.title;
        reelDescription = metadata.description;
        uploader = metadata.uploader;
      } catch (metadataErr) {
        console.error("Metadata fetch failed:", metadataErr);
      }

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

        // Zettelkasten note-building only makes sense with a transcript; it
        // runs independently of the visual analysis so a failure in one
        // doesn't prevent the other from landing in the final page.
        let zettelkastenNotes: string | undefined;
        if (transcript) {
          try {
            zettelkastenNotes = await buildZettelkastenNotes(
              { transcript, sourceUrl, reelTitle, uploader },
              { anthropic: deps.anthropic }
            );
          } catch (zettelkastenErr) {
            console.error("Zettelkasten note generation failed:", zettelkastenErr);
          }
        }

        const analysis = await analyzeContent({ transcript, frames }, { anthropic: deps.anthropic });

        result = {
          status: "Done",
          sourceUrl,
          title: (reelTitle || analysis.title).trim(),
          reelDescription,
          uploader,
          visualDescription: analysis.visualDescription,
          zettelkastenNotes,
          category: analysis.category,
          tags: analysis.tags,
          transcript,
        };
      } catch (analysisErr) {
        const message = analysisErr instanceof Error ? analysisErr.message : String(analysisErr);
        result = {
          status: "Partial",
          sourceUrl,
          title: reelTitle || undefined,
          reelDescription,
          uploader,
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
      title: truncateTitle(result.title ?? sourceUrl),
      sourceUrl: result.sourceUrl,
      category: result.category ?? "Other",
      tags: result.tags ?? [],
      status: result.status,
    });

    const children = markdownToBlocks(buildBodyMarkdown(result));

    try {
      await writeNotionPage(deps.notionClient, deps.notionDatabaseId, properties, children);
    } catch (writeErr) {
      // Never silently drop a saved link: if the full write fails (e.g. an
      // unexpected 400 from a malformed field), retry once with a minimal
      // degraded payload that is unlikely to fail the same way.
      const message = writeErr instanceof Error ? writeErr.message : String(writeErr);
      console.error("Notion write failed, retrying with a degraded payload:", message);

      const degradedProperties = buildPageProperties({
        title: truncateTitle(result.title ?? sourceUrl),
        sourceUrl,
        category: "Other",
        tags: [],
        status: "Failed",
      });
      const degradedChildren = markdownToBlocks(
        `## Source\nURL: ${sourceUrl}\n\n## Error\nNotion write failed: ${message}`
      );

      // If this also throws, let it propagate — the outer .catch() in
      // api/ingest.ts logs it, and there's nothing more we can safely do.
      await writeNotionPage(deps.notionClient, deps.notionDatabaseId, degradedProperties, degradedChildren);

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
