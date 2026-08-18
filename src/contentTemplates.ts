import type Anthropic from "@anthropic-ai/sdk";
import type { Category } from "./types.js";
import { buildZettelkastenNotes } from "./zettelkasten.js";

export interface ContentContext {
  transcript: string | null;
  caption: string;
  siteText: string | null;
  sourceUrl: string;
  reelTitle: string;
  uploader: string;
}

const STEPS_BREAKDOWN_CATEGORIES: readonly Category[] = ["Trading", "Claude Hacks", "Parenting Hacks"];
const DESIGN_IDEAS_CATEGORIES: readonly Category[] = ["Design Hacks", "Design Inspiration"];

async function callClaude(prompt: string, opts: { anthropic: Anthropic }): Promise<string> {
  const response = await opts.anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude response did not contain a text block");
  }
  return textBlock.text.trim();
}

function sourceContextLines(ctx: ContentContext): string[] {
  return [
    `Reel source URL: ${ctx.sourceUrl}`,
    `Creator/uploader: ${ctx.uploader || "unknown"}`,
    `Reel title/caption (from Instagram): ${ctx.reelTitle || "not available"}`,
    `Instagram caption text: ${ctx.caption || "not available"}`,
    `Transcript of the reel's audio: ${ctx.transcript ?? "(no audio / not available)"}`,
    ctx.siteText ? `Content fetched from a linked website in the caption:\n${ctx.siteText}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

export async function buildRecipeNotes(
  ctx: ContentContext,
  opts: { anthropic: Anthropic }
): Promise<string> {
  const prompt = [
    ...sourceContextLines(ctx),
    ``,
    `This is a recipe. Extract the complete recipe from whichever source has the most detail — the linked website content if present, otherwise the caption, otherwise the transcript. If sources conflict, prefer the most complete/specific one and note the discrepancy briefly.`,
    ``,
    `Respond in plain markdown text (not JSON) with exactly these section headers, each alone on its own line:`,
    `"### Ingredients" — a bulleted list ("- " prefix), one ingredient with quantity per line.`,
    `"### Steps" — a numbered breakdown of the method, one clear step per line (e.g. "1. ...", "2. ...").`,
    `"### Notes" — anything useful that doesn't fit the above: substitutions, timing, serving size, tips mentioned. Omit this section entirely if there's nothing to add.`,
    `If the recipe is incomplete or ambiguous in the source material, say so plainly in Notes rather than inventing quantities or steps.`,
  ].join("\n");

  return callClaude(prompt, opts);
}

export async function buildStepsNotes(
  ctx: ContentContext,
  opts: { anthropic: Anthropic }
): Promise<string> {
  const prompt = [
    ...sourceContextLines(ctx),
    ``,
    `Break this content down into a clear, ordered set of steps or takeaways — a technique, hack, or tip explained in the source. Just extract and organize what's actually said; do not add new ideas, opinions, or extensions of your own.`,
    ``,
    `Respond in plain markdown text (not JSON) with exactly this section header, alone on its own line:`,
    `"### Steps"`,
    `Under it, a numbered list ("1. ", "2. ", ...) of the concrete steps/takeaways, each one sentence, in the order they'd actually be done or applied. Keep the original meaning — rephrase for clarity, don't summarize away specifics like exact numbers, tools, or timing mentioned.`,
  ].join("\n");

  return callClaude(prompt, opts);
}

export async function buildDesignIdeasNotes(
  ctx: ContentContext,
  opts: { anthropic: Anthropic }
): Promise<string> {
  const prompt = [
    ...sourceContextLines(ctx),
    ``,
    `This is design-related content (a hack/trick or a piece of inspiration). First break down what's actually shown or said, then go further — bring your own new ideas and connect it to current design trends.`,
    ``,
    `Respond in plain markdown text (not JSON) with exactly these section headers, each alone on its own line:`,
    `"### What They Did" — 2-4 sentences describing the specific technique, tool, or approach shown in the content.`,
    `"### New Ideas & Trends" — several paragraphs of your own original thinking: related or opposing techniques worth trying, how this connects to current design trends you're aware of, and at least one concrete way to push this idea further than the original content did. This is not a summary — it's your own generative thinking built on top of the source.`,
  ].join("\n");

  return callClaude(prompt, opts);
}

export interface ContentNotesResult {
  heading: string;
  notes: string;
}

/**
 * Picks a content-processing template based on category and runs it. Falls
 * back to the general Zettelkasten treatment for any category without a
 * specialized template — that path requires a transcript (per its original
 * design), the specialized templates can work off caption/site text alone.
 */
export async function buildContentNotes(
  category: Category,
  ctx: ContentContext,
  opts: { anthropic: Anthropic }
): Promise<ContentNotesResult | undefined> {
  if (category === "Recipes/Food") {
    if (!ctx.transcript && !ctx.caption && !ctx.siteText) return undefined;
    return { heading: "Recipe", notes: await buildRecipeNotes(ctx, opts) };
  }

  if (STEPS_BREAKDOWN_CATEGORIES.includes(category)) {
    if (!ctx.transcript && !ctx.caption) return undefined;
    return { heading: "Step-by-Step Breakdown", notes: await buildStepsNotes(ctx, opts) };
  }

  if (DESIGN_IDEAS_CATEGORIES.includes(category)) {
    if (!ctx.transcript && !ctx.caption) return undefined;
    return { heading: "Ideas & Trends", notes: await buildDesignIdeasNotes(ctx, opts) };
  }

  if (!ctx.transcript) return undefined;
  return {
    heading: "Zettelkasten Notes",
    notes: await buildZettelkastenNotes(
      { transcript: ctx.transcript, sourceUrl: ctx.sourceUrl, reelTitle: ctx.reelTitle, uploader: ctx.uploader },
      opts
    ),
  };
}
