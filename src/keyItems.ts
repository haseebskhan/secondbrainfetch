import type Anthropic from "@anthropic-ai/sdk";

/**
 * Extracts a short list of distinct named items (tools, websites, apps,
 * products, etc.) when the content presents one, so it can be surfaced as
 * a quick-reference list before the detailed breakdown. Returns an empty
 * array when there's no such list, or on any parsing failure — this is a
 * nice-to-have, never worth failing the pipeline over.
 */
export async function extractKeyItems(
  input: { transcript: string | null; caption: string },
  opts: { anthropic: Anthropic }
): Promise<string[]> {
  if (!input.transcript && !input.caption) return [];

  const prompt = [
    `Transcript: ${input.transcript ?? "(not available)"}`,
    `Caption: ${input.caption || "(not available)"}`,
    ``,
    `If this content mentions a list of multiple distinct named items — tools, websites, apps, products, or techniques named as a set — extract just their names as a short list. Do not extract narrative steps or sentences, only actual named items that form a list. A single tool/concept mentioned in passing does not count as a list.`,
    `Respond with ONLY a JSON array of strings, e.g. ["Item One", "Item Two"]. If there's no such list, respond with exactly [].`,
  ].join("\n");

  const response = await opts.anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return [];

  const jsonText = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
