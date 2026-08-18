import type { Client } from "@notionhq/client";
import type { CreatePageParameters } from "@notionhq/client/build/src/api-endpoints.js";
import type { Category, PipelineStatus } from "./types.js";

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

export function buildPageProperties(data: {
  title: string;
  sourceUrl: string;
  category: Category;
  tags: string[];
  status: PipelineStatus;
}): Record<string, unknown> {
  return {
    Title: { title: [{ text: { content: data.title } }] },
    "Source URL": { url: data.sourceUrl },
    Category: { select: { name: data.category } },
    Tags: { multi_select: data.tags.map((t) => ({ name: t })) },
    "Date Saved": { date: { start: new Date().toISOString() } },
    Status: { select: { name: data.status } },
  };
}

export async function createNotionPage(
  client: Client,
  databaseId: string,
  properties: Record<string, unknown>,
  bodyParagraphs: string[]
): Promise<string> {
  const response = await client.pages.create({
    parent: { database_id: databaseId },
    properties: properties as CreatePageParameters["properties"],
    children: bodyParagraphs.map((text) => ({
      object: "block" as const,
      type: "paragraph" as const,
      paragraph: { rich_text: [{ type: "text" as const, text: { content: text } }] },
    })),
  });
  return response.id;
}
