import { describe, it, expect, vi } from "vitest";
import { buildPageProperties, createNotionPage, markdownToBlocks, chunkText } from "../src/notion.js";

describe("buildPageProperties", () => {
  it("maps fields to Notion property shapes", () => {
    const props = buildPageProperties({
      title: "3-Ingredient Pasta",
      sourceUrl: "https://www.instagram.com/reel/abc123/",
      category: "Recipes/Food",
      tags: ["pasta", "quick meals"],
    });

    expect(props).toEqual({
      Title: { title: [{ text: { content: "3-Ingredient Pasta" } }] },
      "Source URL": { url: "https://www.instagram.com/reel/abc123/" },
      Category: { select: { name: "Recipes/Food" } },
      Tags: { multi_select: [{ name: "pasta" }, { name: "quick meals" }] },
      "Date Saved": { date: { start: expect.any(String) } },
    });
  });

  it("includes Creator and External Source when provided", () => {
    const props = buildPageProperties({
      title: "3-Ingredient Pasta",
      sourceUrl: "https://www.instagram.com/reel/abc123/",
      category: "Recipes/Food",
      tags: [],
      creator: "chefusername",
      externalSourceUrl: "https://example.com/recipe",
    });

    expect(props.Creator).toEqual({ rich_text: [{ text: { content: "chefusername" } }] });
    expect(props["External Source"]).toEqual({ url: "https://example.com/recipe" });
  });

  it("omits Creator and External Source when not provided", () => {
    const props = buildPageProperties({
      title: "3-Ingredient Pasta",
      sourceUrl: "https://www.instagram.com/reel/abc123/",
      category: "Recipes/Food",
      tags: [],
    });

    expect(props.Creator).toBeUndefined();
    expect(props["External Source"]).toBeUndefined();
  });

  it("includes the Related Notes relation property when related page ids are provided", () => {
    const props = buildPageProperties({
      title: "3-Ingredient Pasta",
      sourceUrl: "https://www.instagram.com/reel/abc123/",
      category: "Recipes/Food",
      tags: [],
      relatedPageIds: ["page-a", "page-b"],
    });

    expect(props["Related Notes"]).toEqual({ relation: [{ id: "page-a" }, { id: "page-b" }] });
  });

  it("includes the Embedding property when an encoded embedding is provided", () => {
    const props = buildPageProperties({
      title: "3-Ingredient Pasta",
      sourceUrl: "https://www.instagram.com/reel/abc123/",
      category: "Recipes/Food",
      tags: [],
      embedding: "[0.1,0.2]",
    });

    expect(props.Embedding).toEqual({ rich_text: [{ text: { content: "[0.1,0.2]" } }] });
  });

  it("omits the Embedding property when not provided", () => {
    const props = buildPageProperties({
      title: "3-Ingredient Pasta",
      sourceUrl: "https://www.instagram.com/reel/abc123/",
      category: "Recipes/Food",
      tags: [],
    });

    expect(props.Embedding).toBeUndefined();
  });

  it("omits the Related Notes relation property when there are no related pages", () => {
    const props = buildPageProperties({
      title: "3-Ingredient Pasta",
      sourceUrl: "https://www.instagram.com/reel/abc123/",
      category: "Recipes/Food",
      tags: [],
      relatedPageIds: [],
    });

    expect(props["Related Notes"]).toBeUndefined();
  });
});

describe("createNotionPage", () => {
  it("calls pages.create with the database id, properties, and children blocks", async () => {
    const create = vi.fn().mockResolvedValue({ id: "page-123" });
    const fakeClient = { pages: { create } } as any;
    const children = [
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ type: "text", text: { content: "Source" } }] },
      },
    ];

    const pageId = await createNotionPage(
      fakeClient,
      "db-456",
      { Title: { title: [{ text: { content: "X" } }] } },
      children
    );

    expect(pageId).toBe("page-123");
    expect(create).toHaveBeenCalledWith({
      parent: { database_id: "db-456" },
      properties: { Title: { title: [{ text: { content: "X" } }] } },
      children,
    });
  });

  it("sets an external icon when iconUrl is provided", async () => {
    const create = vi.fn().mockResolvedValue({ id: "page-123" });
    const fakeClient = { pages: { create } } as any;

    await createNotionPage(
      fakeClient,
      "db-456",
      { Title: { title: [{ text: { content: "X" } }] } },
      [],
      "https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2/assets/fill/code-fill.svg"
    );

    expect(create).toHaveBeenCalledWith({
      parent: { database_id: "db-456" },
      properties: { Title: { title: [{ text: { content: "X" } }] } },
      children: [],
      icon: {
        type: "external",
        external: { url: "https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2/assets/fill/code-fill.svg" },
      },
    });
  });
});

describe("markdownToBlocks", () => {
  it("converts a heading_2 line", () => {
    expect(markdownToBlocks("## Source")).toEqual([
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ type: "text", text: { content: "Source" } }] },
      },
    ]);
  });

  it("converts a heading_3 line", () => {
    expect(markdownToBlocks("### 1. Literature Note")).toEqual([
      {
        object: "block",
        type: "heading_3",
        heading_3: { rich_text: [{ type: "text", text: { content: "1. Literature Note" } }] },
      },
    ]);
  });

  it("converts bullet lines to bulleted_list_item blocks", () => {
    expect(markdownToBlocks("- first idea\n* second idea")).toEqual([
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: "first idea" } }] },
      },
      {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: "second idea" } }] },
      },
    ]);
  });

  it("converts numbered lines to numbered_list_item blocks", () => {
    expect(markdownToBlocks("1. Boil the water\n2. Add the pasta")).toEqual([
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [{ type: "text", text: { content: "Boil the water" } }] },
      },
      {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: [{ type: "text", text: { content: "Add the pasta" } }] },
      },
    ]);
  });

  it("bolds a 'Label: text' line's label", () => {
    expect(markdownToBlocks("Title: Willpower depletes with each decision")).toEqual([
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: "Title: " }, annotations: { bold: true } },
            { type: "text", text: { content: "Willpower depletes with each decision" } },
          ],
        },
      },
    ]);
  });

  it("skips blank lines", () => {
    expect(markdownToBlocks("## A\n\n\n## B")).toEqual([
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ type: "text", text: { content: "A" } }] },
      },
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ type: "text", text: { content: "B" } }] },
      },
    ]);
  });

  it("renders a plain line with no label/heading/bullet as a paragraph", () => {
    expect(markdownToBlocks("just a plain sentence")).toEqual([
      {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: "just a plain sentence" } }] },
      },
    ]);
  });

  it("bolds an inline **markdown bold** span within a plain line", () => {
    expect(markdownToBlocks("**Title: **Willpower depletes with each decision")).toEqual([
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: "Title: " }, annotations: { bold: true } },
            { type: "text", text: { content: "Willpower depletes with each decision" } },
          ],
        },
      },
    ]);
  });

  it("handles multiple bold spans and plain text around them in one line", () => {
    expect(markdownToBlocks("before **bold one** middle **bold two** after")).toEqual([
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: "before " } },
            { type: "text", text: { content: "bold one" }, annotations: { bold: true } },
            { type: "text", text: { content: " middle " } },
            { type: "text", text: { content: "bold two" }, annotations: { bold: true } },
            { type: "text", text: { content: " after" } },
          ],
        },
      },
    ]);
  });

  it("chunks a long plain paragraph into multiple blocks under the char limit", () => {
    const longLine = "word ".repeat(500).trim();
    const blocks = markdownToBlocks(longLine);
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      expect(block.type).toBe("paragraph");
      const text = (block as any).paragraph.rich_text[0].text.content as string;
      expect(text.length).toBeLessThanOrEqual(1900);
    }
  });
});

describe("chunkText", () => {
  it("returns the original text unchanged when under the limit", () => {
    expect(chunkText("short")).toEqual(["short"]);
  });
});
