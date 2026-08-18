import type { Client } from "@notionhq/client";
import type { CreatePageParameters } from "@notionhq/client/build/src/api-endpoints.js";
import type { Category, PipelineStatus } from "./types.js";

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
