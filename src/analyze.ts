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
