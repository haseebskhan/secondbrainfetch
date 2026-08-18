import type { Client } from "@notionhq/client";
import type { Category } from "./types.js";

export interface RelatedNote {
  title: string;
  url: string;
}

/**
 * Finds existing pages in the same category that share at least one tag
 * with the new entry, ranked by tag overlap — a lightweight way to start
 * connecting ideas across saves without an extra AI call.
 */
export async function findRelatedNotes(
  client: Client,
  databaseId: string,
  data: { category: Category; tags: string[] },
  opts: { limit?: number } = {}
): Promise<RelatedNote[]> {
  const limit = opts.limit ?? 3;

  const response = await client.databases.query({
    database_id: databaseId,
    filter: { property: "Category", select: { equals: data.category } },
    sorts: [{ property: "Date Saved", direction: "descending" }],
    page_size: 20,
  });

  return response.results
    .map((page: any) => {
      const pageTags: string[] = (page.properties?.Tags?.multi_select ?? []).map((t: any) => t.name);
      const overlap = pageTags.filter((t) => data.tags.includes(t)).length;
      const title = page.properties?.Title?.title?.[0]?.plain_text ?? "Untitled";
      return { title, url: page.url as string, overlap };
    })
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, limit)
    .map(({ title, url }) => ({ title, url }));
}
