import { describe, it, expect, vi } from "vitest";
import { findRelatedNotes } from "../src/relatedNotes.js";

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
