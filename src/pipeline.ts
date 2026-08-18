import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, rm, readFile } from "node:fs/promises";
import type { Client } from "@notionhq/client";
import type Anthropic from "@anthropic-ai/sdk";
import ffmpegStaticPath from "ffmpeg-static";
import type { PipelineResult, RelatedNote } from "./types.js";
import {
  buildPageProperties,
  createNotionPage,
  markdownToBlocks,
  buildSummaryCallout,
  buildTranscriptToggle,
  buildDivider,
} from "./notion.js";
import { downloadMedia as downloadMediaFn, fetchMetadata as fetchMetadataFn } from "./download.js";
import { extractAndTranscribe as extractAndTranscribeFn } from "./transcribe.js";
import { extractFrames as extractFramesFn } from "./vision.js";
import { analyzeContent as analyzeContentFn } from "./analyze.js";
import { buildContentNotes as buildContentNotesFn } from "./contentTemplates.js";
import { extractExternalUrl as extractExternalUrlFn, fetchWebpageText as fetchWebpageTextFn } from "./webfetch.js";
import { extractKeyItems as extractKeyItemsFn } from "./keyItems.js";
import { findExistingPageBySourceUrl as findExistingPageBySourceUrlFn } from "./duplicates.js";
import { findRelatedNotes as findRelatedNotesFn } from "./relatedNotes.js";

const TITLE_MAX_LEN = 200;

export interface PipelineDeps {
  downloadMedia?: typeof downloadMediaFn;
  fetchMetadata?: typeof fetchMetadataFn;
  extractAndTranscribe?: typeof extractAndTranscribeFn;
  extractFrames?: typeof extractFramesFn;
  analyzeContent?: typeof analyzeContentFn;
  buildContentNotes?: typeof buildContentNotesFn;
  extractExternalUrl?: typeof extractExternalUrlFn;
  fetchWebpageText?: typeof fetchWebpageTextFn;
  extractKeyItems?: typeof extractKeyItemsFn;
  findExistingPageBySourceUrl?: typeof findExistingPageBySourceUrlFn;
  findRelatedNotes?: typeof findRelatedNotesFn;
  createNotionPage?: typeof createNotionPage;
  notionClient: Client;
  notionDatabaseId: string;
  openaiApiKey: string;
  anthropic: Anthropic;
}

function truncateTitle(title: string): string {
  return title.length > TITLE_MAX_LEN ? `${title.slice(0, TITLE_MAX_LEN - 1)}…` : title;
}

/**
 * Composes the full page as real Notion blocks, in a deliberate visual
 * hierarchy rather than one flat list of headings:
 *
 *   1. A colored callout with a one-glance summary (if available)
 *   2. Mentioned Tools & Resources (if any) + the category-specific content
 *      notes + Source/metadata — as headed markdown sections
 *   3. The raw transcript, collapsed into a toggle (it's the longest,
 *      least-scannable part of the page)
 *   4. Related Notes, last — cross-links are a "see also," not the point
 *      of the page
 */
function buildPageBlocks(result: PipelineResult): object[] {
  const blocks: object[] = [];

  if (result.summary) {
    blocks.push(buildSummaryCallout(result.summary));
    blocks.push(buildDivider());
  }

  const middleSections: string[] = [];

  if (result.keyItems && result.keyItems.length > 0) {
    middleSections.push(
      `## Mentioned Tools & Resources\n${result.keyItems.map((i) => `- ${i}`).join("\n")}`
    );
  }

  if (result.contentNotes) {
    middleSections.push(`## ${result.contentNotesHeading ?? "Notes"}\n${result.contentNotes}`);
  }

  if (result.errorMessage) {
    middleSections.push(`## Error\n${result.errorMessage}`);
  }

  middleSections.push(
    [
      "## Source",
      `URL: ${result.sourceUrl}`,
      result.uploader ? `Creator: ${result.uploader}` : undefined,
      result.reelDescription ? `Caption: ${result.reelDescription}` : undefined,
      result.externalSourceUrl ? `Linked site: ${result.externalSourceUrl}` : undefined,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  );

  blocks.push(...markdownToBlocks(middleSections.join("\n\n")));
  blocks.push(buildTranscriptToggle(result.transcript ?? "No transcript available."));

  if (result.relatedNotes && result.relatedNotes.length > 0) {
    blocks.push(buildDivider());
    blocks.push(
      ...markdownToBlocks(
        `## Related Notes\n${result.relatedNotes.map((n) => `- ${n.title}: ${n.url}`).join("\n")}`
      )
    );
  }

  return blocks;
}

export async function runPipeline(sourceUrl: string, deps: PipelineDeps): Promise<PipelineResult> {
  const downloadMedia = deps.downloadMedia ?? downloadMediaFn;
  const fetchMetadata = deps.fetchMetadata ?? fetchMetadataFn;
  const extractAndTranscribe = deps.extractAndTranscribe ?? extractAndTranscribeFn;
  const extractFrames = deps.extractFrames ?? extractFramesFn;
  const analyzeContent = deps.analyzeContent ?? analyzeContentFn;
  const buildContentNotes = deps.buildContentNotes ?? buildContentNotesFn;
  const extractExternalUrl = deps.extractExternalUrl ?? extractExternalUrlFn;
  const fetchWebpageText = deps.fetchWebpageText ?? fetchWebpageTextFn;
  const extractKeyItems = deps.extractKeyItems ?? extractKeyItemsFn;
  const findExistingPageBySourceUrl = deps.findExistingPageBySourceUrl ?? findExistingPageBySourceUrlFn;
  const findRelatedNotes = deps.findRelatedNotes ?? findRelatedNotesFn;
  const writeNotionPage = deps.createNotionPage ?? createNotionPage;

  // Skip the whole pipeline (no download, no API spend, no Notion write)
  // when this exact link was already saved — re-sharing a reel shouldn't
  // create a duplicate entry. A failure to check is not fatal; treat it as
  // "not a duplicate" and proceed normally.
  try {
    const isDuplicate = await findExistingPageBySourceUrl(deps.notionClient, deps.notionDatabaseId, sourceUrl);
    if (isDuplicate) {
      return { status: "Duplicate", sourceUrl };
    }
  } catch (dupErr) {
    console.error("Duplicate check failed:", dupErr);
  }

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

      // A caption often links to the original recipe/blog/site — fetch it
      // opportunistically (cheap, non-fatal) so recipe processing has the
      // full ingredient list/steps rather than just what's in the caption.
      let externalSourceUrl: string | undefined;
      let siteText: string | null = null;
      const foundUrl = extractExternalUrl(reelDescription);
      if (foundUrl) {
        externalSourceUrl = foundUrl;
        try {
          siteText = await fetchWebpageText(foundUrl);
        } catch (siteErr) {
          console.error("External site fetch failed:", siteErr);
        }
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
              openaiApiKey: deps.openaiApiKey,
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

        const analysis = await analyzeContent(
          { transcript, frames, caption: reelDescription },
          { anthropic: deps.anthropic }
        );

        // Content-note generation is category-specific (recipe/steps/design
        // ideas/default Zettelkasten) and runs independently of the rest of
        // the analysis — a failure here shouldn't prevent the page from
        // recording the title/category/transcript that already succeeded.
        let contentNotesResult: { heading: string; notes: string } | undefined;
        try {
          contentNotesResult = await buildContentNotes(
            analysis.category,
            { transcript, caption: reelDescription, siteText, sourceUrl, reelTitle, uploader },
            { anthropic: deps.anthropic }
          );
        } catch (contentNotesErr) {
          console.error("Content note generation failed:", contentNotesErr);
        }

        let keyItems: string[] = [];
        try {
          keyItems = await extractKeyItems(
            { transcript, caption: reelDescription },
            { anthropic: deps.anthropic }
          );
        } catch (keyItemsErr) {
          console.error("Key item extraction failed:", keyItemsErr);
        }

        let relatedNotes: RelatedNote[] = [];
        try {
          relatedNotes = await findRelatedNotes(deps.notionClient, deps.notionDatabaseId, {
            category: analysis.category,
            tags: analysis.tags,
          });
        } catch (relatedErr) {
          console.error("Related notes lookup failed:", relatedErr);
        }

        result = {
          status: "Done",
          sourceUrl,
          title: analysis.title.trim(),
          summary: analysis.summary,
          reelDescription,
          uploader,
          externalSourceUrl,
          keyItems,
          contentNotes: contentNotesResult?.notes,
          contentNotesHeading: contentNotesResult?.heading,
          relatedNotes,
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
          externalSourceUrl,
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
      creator: result.uploader,
      externalSourceUrl: result.externalSourceUrl,
      relatedPageIds: result.relatedNotes?.map((n) => n.id),
    });

    const children = buildPageBlocks(result);

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
