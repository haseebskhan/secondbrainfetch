import { describe, it, expect, vi } from "vitest";
import { searchArchiveByMeaning } from "../src/search.js";
import { encodeEmbedding } from "../src/embeddings.js";

function page(url: string, title: string, category: string, embedding: number[]) {
  return {
    url,
    properties: {
      Title: { title: [{ plain_text: title }] },
      Category: { select: { name: category } },
      Embedding: { rich_text: [{ plain_text: encodeEmbedding(embedding) }] },
    },
  };
}

describe("searchArchiveByMeaning", () => {
  it("embeds the query, ranks pages by similarity, and returns title/url/category", async () => {
    const generateEmbedding = vi.fn().mockResolvedValue([1, 0]);
    const query = vi.fn().mockResolvedValue({
      results: [
        page("https://notion.so/a", "Opposite idea", "Trading", [-1, 0]),
        page("https://notion.so/b", "Close match", "Quotes/Inspiration", [0.95, 0.05]),
      ],
    });
    const fakeClient = { databases: { query } } as any;

    const results = await searchArchiveByMeaning(fakeClient, "db-1", "should I keep waiting on this?", {
      openaiApiKey: "sk-test",
      generateEmbedding,
      minSimilarity: 0.3,
    });

    expect(generateEmbedding).toHaveBeenCalledWith("should I keep waiting on this?", { openaiApiKey: "sk-test" });
    expect(results).toEqual([
      { title: "Close match", url: "https://notion.so/b", category: "Quotes/Inspiration", similarity: expect.any(Number) },
    ]);
  });

  it("respects the limit option", async () => {
    const generateEmbedding = vi.fn().mockResolvedValue([1, 0]);
    const query = vi.fn().mockResolvedValue({
      results: [
        page("https://notion.so/a", "A", "Other", [1, 0]),
        page("https://notion.so/b", "B", "Other", [0.99, 0.01]),
        page("https://notion.so/c", "C", "Other", [0.98, 0.02]),
      ],
    });
    const fakeClient = { databases: { query } } as any;

    const results = await searchArchiveByMeaning(fakeClient, "db-1", "anything", {
      openaiApiKey: "sk-test",
      generateEmbedding,
      limit: 2,
    });

    expect(results).toHaveLength(2);
  });

  it("skips pages with a missing or malformed embedding", async () => {
    const generateEmbedding = vi.fn().mockResolvedValue([1, 0]);
    const query = vi.fn().mockResolvedValue({
      results: [{ url: "https://notion.so/a", properties: { Title: { title: [{ plain_text: "No embedding" }] }, Embedding: { rich_text: [] } } }],
    });
    const fakeClient = { databases: { query } } as any;

    const results = await searchArchiveByMeaning(fakeClient, "db-1", "anything", {
      openaiApiKey: "sk-test",
      generateEmbedding,
    });

    expect(results).toEqual([]);
  });
});
