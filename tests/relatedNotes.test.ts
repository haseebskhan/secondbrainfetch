import { describe, it, expect, vi } from "vitest";
import { findRelatedNotes, findSemanticMatches, mergeRelatedNotes } from "../src/relatedNotes.js";
import { encodeEmbedding } from "../src/embeddings.js";

function page(id: string, title: string, url: string, tags: string[]) {
  return {
    id,
    url,
    properties: {
      Title: { title: [{ plain_text: title }] },
      Tags: { multi_select: tags.map((name) => ({ name })) },
    },
  };
}

function embeddedPage(id: string, title: string, url: string, embedding: number[] | null) {
  return {
    id,
    url,
    properties: {
      Title: { title: [{ plain_text: title }] },
      Embedding: embedding ? { rich_text: [{ plain_text: encodeEmbedding(embedding) }] } : { rich_text: [] },
    },
  };
}

describe("findRelatedNotes", () => {
  it("ranks same-category pages by tag overlap, excluding pages with no overlap, and includes page ids", async () => {
    const query = vi.fn().mockResolvedValue({
      results: [
        page("page-a", "No overlap", "https://notion.so/a", ["unrelated"]),
        page("page-b", "One shared tag", "https://notion.so/b", ["pasta"]),
        page("page-c", "Two shared tags", "https://notion.so/c", ["pasta", "quick meals"]),
      ],
    });
    const fakeClient = { databases: { query } } as any;

    const related = await findRelatedNotes(fakeClient, "db-1", {
      category: "Recipes/Food",
      tags: ["pasta", "quick meals"],
    });

    expect(related).toEqual([
      { id: "page-c", title: "Two shared tags", url: "https://notion.so/c" },
      { id: "page-b", title: "One shared tag", url: "https://notion.so/b" },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        database_id: "db-1",
        filter: { property: "Category", select: { equals: "Recipes/Food" } },
      })
    );
  });

  it("respects the limit option", async () => {
    const query = vi.fn().mockResolvedValue({
      results: [
        page("page-a", "A", "https://notion.so/a", ["pasta"]),
        page("page-b", "B", "https://notion.so/b", ["pasta"]),
        page("page-c", "C", "https://notion.so/c", ["pasta"]),
      ],
    });
    const fakeClient = { databases: { query } } as any;

    const related = await findRelatedNotes(
      fakeClient,
      "db-1",
      { category: "Recipes/Food", tags: ["pasta"] },
      { limit: 2 }
    );

    expect(related).toHaveLength(2);
  });

  it("returns an empty array when nothing overlaps", async () => {
    const query = vi.fn().mockResolvedValue({
      results: [page("page-a", "Unrelated", "https://notion.so/a", ["other"])],
    });
    const fakeClient = { databases: { query } } as any;

    const related = await findRelatedNotes(fakeClient, "db-1", {
      category: "Recipes/Food",
      tags: ["pasta"],
    });

    expect(related).toEqual([]);
  });
});

describe("findSemanticMatches", () => {
  it("ranks pages by cosine similarity to the given embedding, excluding those below the threshold", async () => {
    const query = vi.fn().mockResolvedValue({
      results: [
        embeddedPage("page-a", "Opposite idea", "https://notion.so/a", [-1, 0]),
        embeddedPage("page-b", "Somewhat similar", "https://notion.so/b", [0.9, 0.1]),
        embeddedPage("page-c", "Very similar", "https://notion.so/c", [1, 0]),
      ],
    });
    const fakeClient = { databases: { query } } as any;

    const matches = await findSemanticMatches(fakeClient, "db-1", { embedding: [1, 0] });

    expect(matches).toEqual([
      { id: "page-c", title: "Very similar", url: "https://notion.so/c" },
      { id: "page-b", title: "Somewhat similar", url: "https://notion.so/b" },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        database_id: "db-1",
        filter: { property: "Embedding", rich_text: { is_not_empty: true } },
      })
    );
  });

  it("skips pages with a missing or malformed embedding", async () => {
    const query = vi.fn().mockResolvedValue({
      results: [embeddedPage("page-a", "No embedding", "https://notion.so/a", null)],
    });
    const fakeClient = { databases: { query } } as any;

    const matches = await findSemanticMatches(fakeClient, "db-1", { embedding: [1, 0] });

    expect(matches).toEqual([]);
  });

  it("respects the limit option", async () => {
    const query = vi.fn().mockResolvedValue({
      results: [
        embeddedPage("page-a", "A", "https://notion.so/a", [1, 0]),
        embeddedPage("page-b", "B", "https://notion.so/b", [1, 0]),
        embeddedPage("page-c", "C", "https://notion.so/c", [1, 0]),
      ],
    });
    const fakeClient = { databases: { query } } as any;

    const matches = await findSemanticMatches(fakeClient, "db-1", { embedding: [1, 0] }, { limit: 2 });

    expect(matches).toHaveLength(2);
  });
});

describe("mergeRelatedNotes", () => {
  it("keeps tag matches first and appends non-duplicate semantic matches", () => {
    const tagMatches = [{ id: "a", title: "A", url: "https://notion.so/a" }];
    const semanticMatches = [
      { id: "a", title: "A", url: "https://notion.so/a" },
      { id: "b", title: "B", url: "https://notion.so/b" },
    ];

    expect(mergeRelatedNotes(tagMatches, semanticMatches)).toEqual([
      { id: "a", title: "A", url: "https://notion.so/a" },
      { id: "b", title: "B", url: "https://notion.so/b" },
    ]);
  });

  it("respects the overall limit", () => {
    const tagMatches = [
      { id: "a", title: "A", url: "https://notion.so/a" },
      { id: "b", title: "B", url: "https://notion.so/b" },
    ];
    const semanticMatches = [
      { id: "c", title: "C", url: "https://notion.so/c" },
      { id: "d", title: "D", url: "https://notion.so/d" },
    ];

    expect(mergeRelatedNotes(tagMatches, semanticMatches, 3)).toHaveLength(3);
  });
});
