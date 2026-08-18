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
    `You are cataloging a saved Instagram reel/post for a personal knowledge base. The person saving this wants to reference and reuse the ideas in it later without rewatching the video.`,
    `Transcript: ${input.transcript ?? "(no audio / not available)"}`,
    `Pick "category" from exactly this list: ${CATEGORIES.join(", ")}.`,
    `Respond with ONLY a JSON object: { "title": string, "summary": string, "category": string, "tags": string[] }.`,
    `"title" is a short descriptive title.`,
    `"summary" is a detailed, essay-style writeup (several paragraphs, not a couple of sentences) that captures the substance of the content: the specific ideas, steps, arguments, tips, or claims made, in enough depth that the reader can actually use them without watching the original. Write it as standalone reference notes, not a teaser. Do not pad it with filler — every paragraph should carry real content from the source.`,
    `"tags" is 2-5 free-form lowercase keywords.`,
  ].join("\n");

  const response = await opts.anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 4096,
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
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary
      : "No summary available.";
  return {
    title,
    summary,
    category: normalizeCategory(typeof parsed.category === "string" ? parsed.category : ""),
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  };
}
