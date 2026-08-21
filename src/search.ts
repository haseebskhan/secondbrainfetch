import type { Client } from "@notionhq/client";
import { cosineSimilarity, decodeEmbedding, generateEmbedding as generateEmbeddingFn } from "./embeddings.js";

export interface SearchResult {
  title: string;
  url: string;
  category: string;
  similarity: number;
}

/**
 * Live semantic search: embeds an arbitrary query (e.g. a question asked in
 * a Claude conversation) and ranks every page with a stored Embedding by
 * cosine similarity to it — unlike relatedNotes.ts's findSemanticMatches,
 * this compares against a fresh, uncached vector rather than another page's
 * embedding, so it can answer any question, not just "what's related to
 * this specific saved page."
 */
export async function searchArchiveByMeaning(
  client: Client,
  databaseId: string,
  query: string,
  opts: {
    openaiApiKey: string;
    limit?: number;
    minSimilarity?: number;
    generateEmbedding?: typeof generateEmbeddingFn;
  }
): Promise<SearchResult[]> {
  const limit = opts.limit ?? 5;
  const minSimilarity = opts.minSimilarity ?? 0.3;
  const embed = opts.generateEmbedding ?? generateEmbeddingFn;

  const queryVector = await embed(query, { openaiApiKey: opts.openaiApiKey });

  const response = await client.databases.query({
    database_id: databaseId,
    filter: { property: "Embedding", rich_text: { is_not_empty: true } },
    page_size: 100,
  });

  return response.results
    .map((page: any) => {
      const embeddingText = page.properties?.Embedding?.rich_text?.[0]?.plain_text;
      const pageEmbedding = decodeEmbedding(embeddingText);
      const title = page.properties?.Title?.title?.[0]?.plain_text ?? "Untitled";
      const category = page.properties?.Category?.select?.name ?? "Other";
      return {
        title,
        url: page.url as string,
        category,
        similarity: pageEmbedding ? cosineSimilarity(queryVector, pageEmbedding) : -Infinity,
      };
    })
    .filter((entry) => entry.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
