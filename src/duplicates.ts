import type { Client } from "@notionhq/client";

/**
 * Checks whether a page with this exact Source URL already exists in the
 * database, so a re-shared link doesn't create a duplicate entry.
 */
export async function findExistingPageBySourceUrl(
  client: Client,
  databaseId: string,
  sourceUrl: string
): Promise<boolean> {
  const response = await client.databases.query({
    database_id: databaseId,
    filter: { property: "Source URL", url: { equals: sourceUrl } },
    page_size: 1,
  });
  return response.results.length > 0;
}
