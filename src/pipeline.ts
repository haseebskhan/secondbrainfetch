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
