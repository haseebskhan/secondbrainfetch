import { describe, it, expect, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { runPipeline } from "../src/pipeline.js";

function blockText(block: any): string {
  const key = block.type;
  const own = (block[key]?.rich_text ?? []).map((rt: any) => rt.text.content).join("");
  const childBlocks = block[key]?.children ?? [];
  return [own, ...childBlocks.map(blockText)].filter(Boolean).join("\n");
}

function allText(blocks: any[]): string {
  return blocks.map(blockText).join("\n");
}

function baseDeps(overrides: Partial<Record<string, any>> = {}) {
  return {
    downloadMedia: vi.fn().mockResolvedValue({ filePath: "/tmp/out/reel.mp4", isVideo: true }),
    fetchMetadata: vi.fn().mockResolvedValue({
      title: "Video by chefusername",
      description: "A quick weeknight pasta recipe.",
      uploader: "chefusername",
    }),
    extractAndTranscribe: vi.fn().mockResolvedValue("today we're making pasta"),
    extractFrames: vi.fn().mockResolvedValue([Buffer.from("img")]),
    analyzeContent: vi.fn().mockResolvedValue({
      title: "3-Ingredient Weeknight Pasta",
      summary: "A quick 3-ingredient weeknight pasta recipe.",
      category: "Recipes/Food",
      tags: ["pasta"],
    }),
    buildContentNotes: vi
      .fn()
      .mockResolvedValue({ heading: "Recipe", notes: "### Ingredients\n- pasta\n### Steps\n1. Boil water" }),
    extractExternalUrl: vi.fn().mockReturnValue(null),
    fetchWebpageText: vi.fn().mockResolvedValue("fetched site text"),
    extractKeyItems: vi.fn().mockResolvedValue([]),
    findExistingPageBySourceUrl: vi.fn().mockResolvedValue(false),
    findRelatedNotes: vi.fn().mockResolvedValue([]),
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    findSemanticMatches: vi.fn().mockResolvedValue([]),
    createNotionPage: vi.fn().mockResolvedValue("page-1"),
    notionClient: {} as any,
    notionDatabaseId: "db-1",
    openaiApiKey: "sk-test",
    anthropic: {} as any,
    ...overrides,
  };
}

describe("runPipeline", () => {
  it("returns Done status and writes a Notion page on full success", async () => {
    const deps = baseDeps();

    const result = await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(result.status).toBe("Done");
    expect(result.category).toBe("Recipes/Food");
    expect(deps.createNotionPage).toHaveBeenCalledTimes(1);
  });

  it("always uses Claude's rewritten title, not the raw Instagram title", async () => {
    const deps = baseDeps();

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const properties = deps.createNotionPage.mock.calls[0][2];
    expect(properties.Title.title[0].text.content).toBe("3-Ingredient Weeknight Pasta");
  });

  it("passes the caption into analyzeContent", async () => {
    const deps = baseDeps();

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(deps.analyzeContent).toHaveBeenCalledWith(
      { transcript: "today we're making pasta", frames: [Buffer.from("img")], caption: "A quick weeknight pasta recipe." },
      { anthropic: deps.anthropic }
    );
  });

  it("dispatches content-note generation with the category Claude picked", async () => {
    const deps = baseDeps();

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(deps.buildContentNotes).toHaveBeenCalledWith(
      "Recipes/Food",
      {
        transcript: "today we're making pasta",
        caption: "A quick weeknight pasta recipe.",
        siteText: null,
        sourceUrl: "https://www.instagram.com/reel/abc/",
        reelTitle: "Video by chefusername",
        uploader: "chefusername",
      },
      { anthropic: deps.anthropic }
    );
  });

  it("sets the Creator property on the Notion page", async () => {
    const deps = baseDeps();

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const call = deps.createNotionPage.mock.calls[0];
    expect(call[2].Creator.rich_text[0].text.content).toBe("chefusername");
  });

  it("sets a category-specific Phosphor icon URL on the Notion page", async () => {
    const deps = baseDeps();

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const call = deps.createNotionPage.mock.calls[0];
    expect(call[4]).toBe(
      "https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2/assets/fill/bowl-food-fill.svg"
    );
  });

  it("fetches a linked external site found in the caption and passes its text + records External Source", async () => {
    const deps = baseDeps({
      extractExternalUrl: vi.fn().mockReturnValue("https://example.com/recipe"),
    });

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(deps.fetchWebpageText).toHaveBeenCalledWith("https://example.com/recipe");
    expect(deps.buildContentNotes).toHaveBeenCalledWith(
      "Recipes/Food",
      expect.objectContaining({ siteText: "fetched site text" }),
      { anthropic: deps.anthropic }
    );
    const properties = deps.createNotionPage.mock.calls[0][2];
    expect(properties["External Source"]).toEqual({ url: "https://example.com/recipe" });
  });

  it("does not fail the pipeline when the external site fetch throws", async () => {
    const deps = baseDeps({
      extractExternalUrl: vi.fn().mockReturnValue("https://example.com/recipe"),
      fetchWebpageText: vi.fn().mockRejectedValue(new Error("blocked")),
    });

    const result = await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(result.status).toBe("Done");
    expect(deps.buildContentNotes).toHaveBeenCalledWith(
      "Recipes/Food",
      expect.objectContaining({ siteText: null }),
      { anthropic: deps.anthropic }
    );
  });

  it("includes Source, the content-notes heading, and Raw Transcript sections in the body, with no Visual Description", async () => {
    const deps = baseDeps();

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const children = deps.createNotionPage.mock.calls[0][3];
    const text = allText(children);
    expect(text).toContain("Source");
    expect(text).toContain("chefusername");
    expect(text).toContain("Ingredients");
    expect(text).toContain("Raw Transcript");
    expect(text).toContain("today we're making pasta");
    expect(text).not.toContain("Visual Description");
  });

  it("skips content-note generation when buildContentNotes returns undefined", async () => {
    const deps = baseDeps({
      buildContentNotes: vi.fn().mockResolvedValue(undefined),
    });

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const children = deps.createNotionPage.mock.calls[0][3];
    const text = allText(children);
    expect(text).not.toContain("Ingredients");
  });

  it("orders the body: callout summary first, Source after content notes, transcript toggle after Source", async () => {
    const deps = baseDeps();

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const children = deps.createNotionPage.mock.calls[0][3];

    expect(children[0].type).toBe("callout");
    expect(blockText(children[0])).toContain("A quick 3-ingredient weeknight pasta recipe.");

    const headingIndex = (label: string) =>
      children.findIndex((b: any) => b.type === "heading_2" && blockText(b) === label);
    const toggleIndex = children.findIndex((b: any) => b.type === "toggle");

    expect(headingIndex("Source")).toBeGreaterThan(headingIndex("Recipe"));
    expect(toggleIndex).toBeGreaterThan(headingIndex("Source"));
    expect(blockText(children[toggleIndex])).toContain("Raw Transcript");
  });

  it("orders Related Notes as the very last section, after the transcript toggle", async () => {
    const deps = baseDeps({
      findRelatedNotes: vi
        .fn()
        .mockResolvedValue([
          { id: "page-earlier", title: "Earlier Pasta Reel", url: "https://notion.so/earlier" },
        ]),
    });

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const children = deps.createNotionPage.mock.calls[0][3];
    const toggleIndex = children.findIndex((b: any) => b.type === "toggle");
    const relatedIndex = children.findIndex(
      (b: any) => b.type === "heading_2" && blockText(b) === "Related Notes"
    );

    expect(relatedIndex).toBeGreaterThan(toggleIndex);
    expect(relatedIndex).toBe(children.length - 2); // heading followed by the bullet line
  });

  it("omits the callout when there is no summary", async () => {
    const deps = baseDeps({
      analyzeContent: vi.fn().mockResolvedValue({
        title: "3-Ingredient Weeknight Pasta",
        summary: "",
        category: "Recipes/Food",
        tags: ["pasta"],
      }),
    });

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const children = deps.createNotionPage.mock.calls[0][3];
    expect(children.some((b: any) => b.type === "callout")).toBe(false);
  });

  it("skips the whole pipeline (no download, no Notion write) when the Source URL is already saved", async () => {
    const deps = baseDeps({
      findExistingPageBySourceUrl: vi.fn().mockResolvedValue(true),
    });

    const result = await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(result.status).toBe("Duplicate");
    expect(deps.downloadMedia).not.toHaveBeenCalled();
    expect(deps.createNotionPage).not.toHaveBeenCalled();
  });

  it("proceeds normally when the duplicate check itself fails", async () => {
    const deps = baseDeps({
      findExistingPageBySourceUrl: vi.fn().mockRejectedValue(new Error("Notion API down")),
    });

    const result = await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(result.status).toBe("Done");
    expect(deps.createNotionPage).toHaveBeenCalledTimes(1);
  });

  it("includes a Mentioned Tools & Resources section at the top when extractKeyItems finds a list", async () => {
    const deps = baseDeps({
      extractKeyItems: vi.fn().mockResolvedValue(["Ponytail", "Claude Mem"]),
    });

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const children = deps.createNotionPage.mock.calls[0][3];
    const headings = children
      .filter((b: any) => b.type === "heading_2")
      .map((b: any) => blockText(b));
    expect(headings[0]).toBe("Mentioned Tools & Resources");
    const text = allText(children);
    expect(text).toContain("Ponytail");
    expect(text).toContain("Claude Mem");
  });

  it("omits the Mentioned Tools & Resources section when extractKeyItems finds nothing", async () => {
    const deps = baseDeps();

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const children = deps.createNotionPage.mock.calls[0][3];
    const text = allText(children);
    expect(text).not.toContain("Mentioned Tools & Resources");
  });

  it("includes a Related Notes section linking pages findRelatedNotes returns", async () => {
    const deps = baseDeps({
      findRelatedNotes: vi
        .fn()
        .mockResolvedValue([
          { id: "page-earlier", title: "Earlier Pasta Reel", url: "https://notion.so/earlier" },
        ]),
    });

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const children = deps.createNotionPage.mock.calls[0][3];
    const text = allText(children);
    expect(text).toContain("Related Notes");
    expect(text).toContain("Earlier Pasta Reel");
    expect(text).toContain("https://notion.so/earlier");
  });

  it("sets the Related Notes relation property with the ids findRelatedNotes returns", async () => {
    const deps = baseDeps({
      findRelatedNotes: vi
        .fn()
        .mockResolvedValue([
          { id: "page-earlier", title: "Earlier Pasta Reel", url: "https://notion.so/earlier" },
        ]),
    });

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const properties = deps.createNotionPage.mock.calls[0][2];
    expect(properties["Related Notes"]).toEqual({ relation: [{ id: "page-earlier" }] });
  });

  it("omits the Related Notes relation property when nothing is related", async () => {
    const deps = baseDeps();

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const properties = deps.createNotionPage.mock.calls[0][2];
    expect(properties["Related Notes"]).toBeUndefined();
  });

  it("calls findRelatedNotes with the category and tags Claude picked", async () => {
    const deps = baseDeps();

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(deps.findRelatedNotes).toHaveBeenCalledWith(deps.notionClient, deps.notionDatabaseId, {
      category: "Recipes/Food",
      tags: ["pasta"],
    });
  });

  it("merges semantic matches into Related Notes and stores the embedding on the page", async () => {
    const deps = baseDeps({
      generateEmbedding: vi.fn().mockResolvedValue([0.5, 0.5]),
      findSemanticMatches: vi
        .fn()
        .mockResolvedValue([{ id: "page-semantic", title: "A Different-Topic Idea", url: "https://notion.so/semantic" }]),
    });

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const properties = deps.createNotionPage.mock.calls[0][2];
    expect(properties["Related Notes"]).toEqual({
      relation: [{ id: "page-semantic" }],
    });
    expect(properties.Embedding.rich_text[0].text.content).toBe("[0.5,0.5]");
    expect(deps.findSemanticMatches).toHaveBeenCalledWith(deps.notionClient, deps.notionDatabaseId, {
      embedding: [0.5, 0.5],
    });
  });

  it("still writes the page and tag-based related notes when the embedding step fails", async () => {
    const deps = baseDeps({
      generateEmbedding: vi.fn().mockRejectedValue(new Error("embeddings API down")),
      findRelatedNotes: vi
        .fn()
        .mockResolvedValue([{ id: "page-earlier", title: "Earlier Pasta Reel", url: "https://notion.so/earlier" }]),
    });

    const result = await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(result.status).toBe("Done");
    const properties = deps.createNotionPage.mock.calls[0][2];
    expect(properties["Related Notes"]).toEqual({ relation: [{ id: "page-earlier" }] });
    expect(properties.Embedding).toBeUndefined();
  });

  it("skips ffmpeg-based transcription/frame extraction and reads the image directly for image posts", async () => {
    const tmpFile = path.join(os.tmpdir(), `pipeline-test-image-${randomUUID()}.jpg`);
    await writeFile(tmpFile, Buffer.from("fake-image-bytes"));

    try {
      const deps = baseDeps({
        downloadMedia: vi.fn().mockResolvedValue({ filePath: tmpFile, isVideo: false }),
      });

      const result = await runPipeline("https://www.instagram.com/p/xyz/", deps as any);

      expect(deps.extractAndTranscribe).not.toHaveBeenCalled();
      expect(deps.extractFrames).not.toHaveBeenCalled();
      expect(deps.analyzeContent).toHaveBeenCalledWith(
        { transcript: null, frames: [expect.any(Buffer)], caption: "A quick weeknight pasta recipe." },
        { anthropic: deps.anthropic }
      );
      expect(result.status).toBe("Done");
    } finally {
      await rm(tmpFile, { force: true });
    }
  });

  it("still writes a Failed Notion page when download fails", async () => {
    const deps = baseDeps({
      downloadMedia: vi.fn().mockRejectedValue(new Error("private account")),
    });

    const result = await runPipeline("https://www.instagram.com/reel/bad/", deps as any);

    expect(result.status).toBe("Failed");
    expect(result.errorMessage).toMatch(/private account/);
    expect(deps.createNotionPage).toHaveBeenCalledTimes(1);
  });

  it("marks Partial when analysis fails after a successful download", async () => {
    const deps = baseDeps({
      analyzeContent: vi.fn().mockRejectedValue(new Error("Claude timeout")),
    });

    const result = await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(result.status).toBe("Partial");
    expect(deps.createNotionPage).toHaveBeenCalledTimes(1);
  });

  it("still runs frame extraction and analysis when transcription fails for a reason other than 'no audio'", async () => {
    const deps = baseDeps({
      extractAndTranscribe: vi.fn().mockRejectedValue(new Error("Whisper API 500")),
    });

    const result = await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(deps.extractFrames).toHaveBeenCalled();
    expect(deps.analyzeContent).toHaveBeenCalledWith(
      { transcript: null, frames: [Buffer.from("img")], caption: "A quick weeknight pasta recipe." },
      { anthropic: deps.anthropic }
    );
    expect(result.status).toBe("Done");
  });

  it("still runs transcription and analysis when frame extraction fails", async () => {
    const deps = baseDeps({
      extractFrames: vi.fn().mockRejectedValue(new Error("ffmpeg crashed")),
    });

    const result = await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(deps.extractAndTranscribe).toHaveBeenCalled();
    expect(deps.analyzeContent).toHaveBeenCalledWith(
      { transcript: "today we're making pasta", frames: [], caption: "A quick weeknight pasta recipe." },
      { anthropic: deps.anthropic }
    );
    expect(result.status).toBe("Done");
  });

  it("skips frame extraction and vision when the transcript is already substantial", async () => {
    const substantialTranscript = "word ".repeat(60).trim(); // 60 words, over the 50-word threshold
    const deps = baseDeps({
      extractAndTranscribe: vi.fn().mockResolvedValue(substantialTranscript),
    });

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(deps.extractFrames).not.toHaveBeenCalled();
    expect(deps.analyzeContent).toHaveBeenCalledWith(
      { transcript: substantialTranscript, frames: [], caption: "A quick weeknight pasta recipe." },
      { anthropic: deps.anthropic }
    );
  });

  it("still extracts frames when the transcript is short (below the vision-skip threshold)", async () => {
    const shortTranscript = "word ".repeat(10).trim(); // 10 words, under the 50-word threshold
    const deps = baseDeps({
      extractAndTranscribe: vi.fn().mockResolvedValue(shortTranscript),
    });

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(deps.extractFrames).toHaveBeenCalled();
  });

  it("chunks a long transcript into multiple paragraphs inside the toggle, each under Notion's 2000-char limit", async () => {
    const longTranscript = "word ".repeat(500); // ~2500 chars
    const deps = baseDeps({
      extractAndTranscribe: vi.fn().mockResolvedValue(longTranscript),
    });

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const children = deps.createNotionPage.mock.calls[0][3];
    const toggle = children.find((b: any) => b.type === "toggle");
    const transcriptChunks: any[] = toggle.toggle.children;

    expect(transcriptChunks.length).toBeGreaterThan(1);
    for (const chunk of transcriptChunks) {
      expect(blockText(chunk).length).toBeLessThanOrEqual(1900);
    }
  });

  it("retries with a degraded Failed payload when the Notion write fails", async () => {
    const createNotionPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("400 body too long"))
      .mockResolvedValueOnce("page-fallback");
    const deps = baseDeps({ createNotionPage });

    const result = await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    expect(createNotionPage).toHaveBeenCalledTimes(2);
    const [, , , degradedChildren] = createNotionPage.mock.calls[1];
    const degradedText = allText(degradedChildren);
    expect(degradedText).toContain("Notion write failed");
    expect(degradedText).not.toContain("today we're making pasta");
    expect(result.status).toBe("Failed");
  });

  it("propagates the error if even the degraded retry write fails", async () => {
    const createNotionPage = vi.fn().mockRejectedValue(new Error("still failing"));
    const deps = baseDeps({ createNotionPage });

    await expect(
      runPipeline("https://www.instagram.com/reel/abc/", deps as any)
    ).rejects.toThrow(/still failing/);
  });
});
