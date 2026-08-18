import type { Client } from "@notionhq/client";
import type { CreatePageParameters } from "@notionhq/client/build/src/api-endpoints.js";
import type { Category } from "./types.js";

/**
 * Notion's rich_text content field caps at 2000 characters per block. Splits
 * `text` into chunks no longer than `maxLen`, breaking on the nearest
 * preceding whitespace when possible (hard-splitting otherwise).
 */
export function chunkText(text: string, maxLen = 1900): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf(" ", maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

type RichText = { type: "text"; text: { content: string }; annotations?: { bold: boolean } };
type NotionBlock =
  | { object: "block"; type: "heading_2"; heading_2: { rich_text: RichText[] } }
  | { object: "block"; type: "heading_3"; heading_3: { rich_text: RichText[] } }
  | { object: "block"; type: "bulleted_list_item"; bulleted_list_item: { rich_text: RichText[] } }
  | { object: "block"; type: "numbered_list_item"; numbered_list_item: { rich_text: RichText[] } }
  | { object: "block"; type: "paragraph"; paragraph: { rich_text: RichText[] } }
  | { object: "block"; type: "callout"; callout: { rich_text: RichText[]; icon: unknown; color: string } }
  | { object: "block"; type: "toggle"; toggle: { rich_text: RichText[]; children: NotionBlock[] } }
  | { object: "block"; type: "divider"; divider: Record<string, never> };

const LABEL_LINE = /^([A-Za-z][A-Za-z0-9 /]{1,40}):\s*(.*)$/;
const NUMBERED_LINE = /^\d+\.\s+(.*)$/;
const BOLD_SPAN = /\*\*(.+?)\*\*/g;

/**
 * Splits inline "**bold**" markdown spans out of a line of text into
 * alternating plain/bold rich_text segments. Falls back to a single plain
 * segment when there's no bold markup.
 */
function parseInlineRichText(text: string): RichText[] {
  const segments: RichText[] = [];
  let lastIndex = 0;
  BOLD_SPAN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BOLD_SPAN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", text: { content: text.slice(lastIndex, match.index) } });
    }
    if (match[1]) {
      segments.push({ type: "text", text: { content: match[1] }, annotations: { bold: true } });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", text: { content: text.slice(lastIndex) } });
  }
  return segments.length > 0 ? segments : [{ type: "text", text: { content: text } }];
}

function paragraphBlocks(text: string): NotionBlock[] {
  return chunkText(text).map((chunk) => ({
    object: "block" as const,
    type: "paragraph" as const,
    paragraph: { rich_text: chunk.includes("**") ? parseInlineRichText(chunk) : [{ type: "text" as const, text: { content: chunk } }] },
  }));
}

function labelParagraphBlocks(label: string, rest: string): NotionBlock[] {
  const chunks = rest ? chunkText(rest) : [""];
  const [first, ...restChunks] = chunks;
  const firstBlock: NotionBlock = {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        { type: "text", text: { content: `${label}: ` }, annotations: { bold: true } },
        ...(first ? [{ type: "text" as const, text: { content: first } }] : []),
      ],
    },
  };
  return [firstBlock, ...restChunks.map((chunk) => paragraphBlocks(chunk)[0])];
}

/**
 * Converts a constrained markdown subset (## / ### headings, "- "/"* "
 * bullets, "Label: text" bold-label lines, and plain paragraphs) into Notion
 * blocks. Blank lines are skipped; long text is chunked to stay under
 * Notion's per-block rich_text limit.
 */
export function markdownToBlocks(markdown: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") continue;

    if (line.startsWith("### ")) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: { rich_text: [{ type: "text", text: { content: line.slice(4).trim() } }] },
      });
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ type: "text", text: { content: line.slice(3).trim() } }] },
      });
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      const content = line.slice(2).trim();
      const chunks = chunkText(content);
      for (const chunk of chunks) {
        blocks.push({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: chunk.includes("**")
              ? parseInlineRichText(chunk)
              : [{ type: "text", text: { content: chunk } }],
          },
        });
      }
      continue;
    }

    const numberedMatch = line.match(NUMBERED_LINE);
    if (numberedMatch) {
      const content = numberedMatch[1].trim();
      const chunks = chunkText(content);
      for (const chunk of chunks) {
        blocks.push({
          object: "block",
          type: "numbered_list_item",
          numbered_list_item: {
            rich_text: chunk.includes("**")
              ? parseInlineRichText(chunk)
              : [{ type: "text", text: { content: chunk } }],
          },
        });
      }
      continue;
    }

    const labelMatch = line.match(LABEL_LINE);
    if (labelMatch) {
      blocks.push(...labelParagraphBlocks(labelMatch[1], labelMatch[2]));
      continue;
    }

    blocks.push(...paragraphBlocks(line));
  }

  return blocks;
}

/**
 * A short, colored at-a-glance summary at the top of the page — so the
 * user can tell what a saved page is about without reading further.
 */
export function buildSummaryCallout(summary: string): NotionBlock {
  const text = summary.length > 1900 ? `${summary.slice(0, 1899)}…` : summary;
  return {
    object: "block",
    type: "callout",
    callout: {
      rich_text: text.includes("**") ? parseInlineRichText(text) : [{ type: "text", text: { content: text } }],
      icon: { type: "emoji", emoji: "💡" },
      color: "blue_background",
    },
  };
}

/**
 * The raw transcript is the longest, least-scannable section on the page —
 * collapsing it into a toggle keeps the page readable by default while
 * keeping the full text one click away.
 */
export function buildTranscriptToggle(transcript: string): NotionBlock {
  return {
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: [{ type: "text", text: { content: "Raw Transcript" }, annotations: { bold: true } }],
      children: chunkText(transcript).map((chunk) => ({
        object: "block" as const,
        type: "paragraph" as const,
        paragraph: { rich_text: [{ type: "text" as const, text: { content: chunk } }] },
      })),
    },
  };
}

export function buildDivider(): NotionBlock {
  return { object: "block", type: "divider", divider: {} };
}

export function buildPageProperties(data: {
  title: string;
  sourceUrl: string;
  category: Category;
  tags: string[];
  creator?: string;
  externalSourceUrl?: string;
  relatedPageIds?: string[];
}): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    Title: { title: [{ text: { content: data.title } }] },
    "Source URL": { url: data.sourceUrl },
    Category: { select: { name: data.category } },
    Tags: { multi_select: data.tags.map((t) => ({ name: t })) },
    "Date Saved": { date: { start: new Date().toISOString() } },
  };
  if (data.creator) {
    properties.Creator = { rich_text: [{ text: { content: data.creator } }] };
  }
  if (data.externalSourceUrl) {
    properties["External Source"] = { url: data.externalSourceUrl };
  }
  if (data.relatedPageIds && data.relatedPageIds.length > 0) {
    properties["Related Notes"] = { relation: data.relatedPageIds.map((id) => ({ id })) };
  }
  return properties;
}

export async function createNotionPage(
  client: Client,
  databaseId: string,
  properties: Record<string, unknown>,
  children: object[],
  iconUrl?: string
): Promise<string> {
  const response = await client.pages.create({
    parent: { database_id: databaseId },
    properties: properties as CreatePageParameters["properties"],
    children: children as CreatePageParameters["children"],
    ...(iconUrl ? { icon: { type: "external" as const, external: { url: iconUrl } } } : {}),
  });
  return response.id;
}
