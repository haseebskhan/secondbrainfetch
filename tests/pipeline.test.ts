import { describe, it, expect, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { runPipeline } from "../src/pipeline.js";

function blockText(block: any): string {
  const key = block.type;
  return (block[key]?.rich_text ?? []).map((rt: any) => rt.text.content).join("");
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
      category: "Recipes/Food",
      tags: ["pasta"],
    }),
    buildContentNotes: vi
      .fn()
      .mockResolvedValue({ heading: "Recipe", notes: "### Ingredients\n- pasta\n### Steps\n1. Boil water" }),
    extractExternalUrl: vi.fn().mockReturnValue(null),
    fetchWebpageText: vi.fn().mockResolvedValue("fetched site text"),
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

  it("sets the category icon and Creator/External Source properties on the Notion page", async () => {
    const deps = baseDeps();

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const [, , properties, , icon] = deps.createNotionPage.mock.calls[0];
    expect(properties.Creator.rich_text[0].text.content).toBe("chefusername");
    expect(icon).toBe("⬛"); // Recipes/Food icon
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

  it("chunks a long transcript into multiple body blocks to stay under Notion's 2000-char limit", async () => {
    const longTranscript = "word ".repeat(500); // ~2500 chars
    const deps = baseDeps({
      extractAndTranscribe: vi.fn().mockResolvedValue(longTranscript),
    });

    await runPipeline("https://www.instagram.com/reel/abc/", deps as any);

    const children = deps.createNotionPage.mock.calls[0][3];
    const transcriptBlocks = children.filter((b: any) => blockText(b).includes("word"));
    expect(transcriptBlocks.length).toBeGreaterThan(1);
    for (const block of children) {
      expect(blockText(block).length).toBeLessThanOrEqual(1900);
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
