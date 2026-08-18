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
    `You are cataloging a saved Instagram reel/post for a personal knowledge base. The person saving this wants detailed reference notes plus fresh thinking inspired by the content, not just a rehash.`,
    `Transcript (verbatim, from audio): ${input.transcript ?? "(no audio / not available)"}`,
    `Pick "category" from exactly this list: ${CATEGORIES.join(", ")}.`,
    `Respond with ONLY a JSON object: { "title": string, "visualDescription": string, "ideas": string, "category": string, "tags": string[] }.`,
    `"title" is a short descriptive title.`,
    `"visualDescription" is a detailed, essay-style writeup (several paragraphs) of what is shown visually in the frames — the setting, actions, on-screen text, people, objects, and any visual steps or demonstrations. Combine this with what the transcript says to describe the full content, but focus this field specifically on the visual layer; don't just restate the transcript here.`,
    `"ideas" is a separate essay-style writeup (several paragraphs) of NEW ideas, extensions, applications, or angles inspired by this content — going beyond what was said or shown. Build on the source material with original thinking: what could someone do with this, what's a related idea it suggests, what's a deeper or more interesting take. This is not a summary of the content — it's your own generative thinking sparked by it.`,
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
  const visualDescription =
    typeof parsed.visualDescription === "string" && parsed.visualDescription.trim()
      ? parsed.visualDescription
      : "No visual description available.";
  const ideas =
    typeof parsed.ideas === "string" && parsed.ideas.trim()
      ? parsed.ideas
      : "No ideas generated.";
  return {
    title,
    visualDescription,
    ideas,
    category: normalizeCategory(typeof parsed.category === "string" ? parsed.category : ""),
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  };
}
