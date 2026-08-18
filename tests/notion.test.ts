import { describe, it, expect, vi } from "vitest";
import { buildPageProperties, createNotionPage } from "../src/notion.js";

describe("buildPageProperties", () => {
  it("maps fields to Notion property shapes", () => {
    const props = buildPageProperties({
      title: "3-Ingredient Pasta",
      sourceUrl: "https://www.instagram.com/reel/abc123/",
      category: "Recipes/Food",
      tags: ["pasta", "quick meals"],
      status: "Done",
    });

    expect(props).toEqual({
      Title: { title: [{ text: { content: "3-Ingredient Pasta" } }] },
      "Source URL": { url: "https://www.instagram.com/reel/abc123/" },
      Category: { select: { name: "Recipes/Food" } },
      Tags: { multi_select: [{ name: "pasta" }, { name: "quick meals" }] },
      "Date Saved": { date: { start: expect.any(String) } },
      Status: { select: { name: "Done" } },
    });
  });
});

describe("createNotionPage", () => {
  it("calls pages.create with the database id, properties, and body paragraphs", async () => {
    const create = vi.fn().mockResolvedValue({ id: "page-123" });
    const fakeClient = { pages: { create } } as any;

    const pageId = await createNotionPage(
      fakeClient,
      "db-456",
      { Title: { title: [{ text: { content: "X" } }] } },
      ["Transcript: hello world", "Source: https://instagram.com/reel/abc"]
    );

    expect(pageId).toBe("page-123");
    expect(create).toHaveBeenCalledWith({
      parent: { database_id: "db-456" },
      properties: { Title: { title: [{ text: { content: "X" } }] } },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: "Transcript: hello world" } }] },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: "Source: https://instagram.com/reel/abc" } }] },
        },
      ],
    });
  });
});
