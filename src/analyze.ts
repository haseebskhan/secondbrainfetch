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
    `Transcript (verbatim, from audio): ${input.transcript ?? "(no audio / not available)"}`,
    `Pick "category" from exactly this list: ${CATEGORIES.join(", ")}.`,
    `Respond with ONLY a JSON object: { "title": string, "category": string, "tags": string[] }.`,
    `"title" is a short descriptive title, used only as a fallback if the actual Instagram post title/caption is unavailable.`,
    `"tags" is 2-5 free-form lowercase keywords describing the content.`,
  ].join("\n");

  const response = await opts.anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 512,
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

  const jsonText = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const parsed = JSON.parse(jsonText);
  const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : "Untitled";
  return {
    title,
    category: normalizeCategory(typeof parsed.category === "string" ? parsed.category : ""),
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  };
}
