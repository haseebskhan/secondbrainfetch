import type { Client } from "@notionhq/client";
import type { Category } from "./types.js";
import { cosineSimilarity, decodeEmbedding } from "./embeddings.js";

export interface RelatedNote {
  id: string;
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
      return { id: page.id as string, title, url: page.url as string, overlap };
    })
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, limit)
    .map(({ id, title, url }) => ({ id, title, url }));
}

/**
 * Finds existing pages whose stored embedding is semantically close to the
 * new entry's, regardless of category or shared tags — this is what catches
 * "different topic, same underlying idea" connections that tag overlap
 * misses entirely.
 */
export async function findSemanticMatches(
  client: Client,
  databaseId: string,
  data: { embedding: number[] },
  opts: { limit?: number; minSimilarity?: number } = {}
): Promise<RelatedNote[]> {
  const limit = opts.limit ?? 3;
  const minSimilarity = opts.minSimilarity ?? 0.5;

  const response = await client.databases.query({
    database_id: databaseId,
    filter: { property: "Embedding", rich_text: { is_not_empty: true } },
    sorts: [{ property: "Date Saved", direction: "descending" }],
    page_size: 100,
  });

  return response.results
    .map((page: any) => {
      const embeddingText = page.properties?.Embedding?.rich_text?.[0]?.plain_text;
      const pageEmbedding = decodeEmbedding(embeddingText);
      const title = page.properties?.Title?.title?.[0]?.plain_text ?? "Untitled";
      return {
        id: page.id as string,
        title,
        url: page.url as string,
        similarity: pageEmbedding ? cosineSimilarity(data.embedding, pageEmbedding) : -Infinity,
      };
    })
    .filter((entry) => entry.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map(({ id, title, url }) => ({ id, title, url }));
}

/**
 * Combines tag-based and semantic matches into one Related Notes list,
 * tag matches first (the more reliable, "obvious" signal), then semantic
 * matches filling any remaining slots up to `limit`, deduped by page id.
 */
export function mergeRelatedNotes(
  tagMatches: RelatedNote[],
  semanticMatches: RelatedNote[],
  limit = 5
): RelatedNote[] {
  const merged = [...tagMatches];
  const seenIds = new Set(tagMatches.map((n) => n.id));
  for (const note of semanticMatches) {
    if (!seenIds.has(note.id)) {
      merged.push(note);
      seenIds.add(note.id);
    }
  }
  return merged.slice(0, limit);
}
