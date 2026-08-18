import type Anthropic from "@anthropic-ai/sdk";
import type { AnalysisResult } from "./types.js";
import { CATEGORIES, normalizeCategory } from "./categories.js";

export async function analyzeContent(
  input: { transcript: string | null; frames: Buffer[]; caption?: string },
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
    input.caption ? `Instagram caption: ${input.caption}` : undefined,
    `Pick "category" from exactly this list: ${CATEGORIES.join(", ")}.`,
    `Respond with ONLY a JSON object: { "title": string, "summary": string, "category": string, "tags": string[] }.`,
    `"title" is ALWAYS a rewritten, clear, descriptive title for the actual content — not the raw Instagram caption or a generic "Video by X" label. It should let someone scanning a list of saved pages immediately know what's on this one (e.g. "3-Ingredient Weeknight Pasta" not "Video by chefusername").`,
    `"summary" is a single short sentence (two at most) describing what this content is about, meant to sit at the very top of the page in a callout so someone can tell what it's about at a glance without reading further. This is distinct from the detailed notes elsewhere on the page — keep it brief and concrete, not a teaser.`,
    `"tags" is 2-5 free-form lowercase keywords describing the content.`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

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
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "";
  return {
    title,
    summary,
    category: normalizeCategory(typeof parsed.category === "string" ? parsed.category : ""),
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  };
}
