import { describe, it, expect, vi } from "vitest";
import { buildContentNotes } from "../src/contentTemplates.js";

function fakeAnthropic(text: string) {
  const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text }] });
  return { anthropic: { messages: { create } } as any, create };
}

function ctx(overrides: Partial<Record<string, any>> = {}) {
  return {
    transcript: "boil water, add pasta, cook for 8 minutes",
    caption: "3-ingredient pasta recipe",
    siteText: null,
    sourceUrl: "https://www.instagram.com/reel/abc/",
    reelTitle: "Video by chefusername",
    uploader: "chefusername",
    ...overrides,
  };
}

describe("buildContentNotes", () => {
  it("dispatches Recipes/Food to the recipe template with an 'Recipe' heading", async () => {
    const { anthropic, create } = fakeAnthropic("### Ingredients\n- pasta\n### Steps\n1. Boil water");

    const result = await buildContentNotes("Recipes/Food", ctx(), { anthropic });

    expect(result?.heading).toBe("Recipe");
    expect(result?.notes).toContain("Ingredients");
    const prompt = create.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("This is a recipe");
  });

  it("dispatches Trading/Claude Hacks/Parenting Hacks to the steps-only template", async () => {
    const { anthropic, create } = fakeAnthropic("### Steps\n1. Do this");

    const result = await buildContentNotes("Trading", ctx(), { anthropic });

    expect(result?.heading).toBe("Step-by-Step Breakdown");
    const prompt = create.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("do not add new ideas");
  });

  it("dispatches Design Hacks/Design Inspiration to the ideas+trends template", async () => {
    const { anthropic, create } = fakeAnthropic("### What They Did\n...\n### New Ideas & Trends\n...");

    const result = await buildContentNotes("Design Inspiration", ctx(), { anthropic });

    expect(result?.heading).toBe("Ideas & Trends");
    const prompt = create.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("bring your own new ideas");
  });

  it("falls back to the default Zettelkasten template for unspecialized categories", async () => {
    const { anthropic } = fakeAnthropic("### 1. Literature Note\n...");

    const result = await buildContentNotes("Fitness/Health", ctx(), { anthropic });

    expect(result?.heading).toBe("Zettelkasten Notes");
  });

  it("returns undefined for the default template when there is no transcript", async () => {
    const { anthropic, create } = fakeAnthropic("unused");

    const result = await buildContentNotes(
      "Fitness/Health",
      ctx({ transcript: null }),
      { anthropic }
    );

    expect(result).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it("still runs the recipe template with no transcript, using caption/site text alone", async () => {
    const { anthropic, create } = fakeAnthropic("### Ingredients\n- flour");

    const result = await buildContentNotes(
      "Recipes/Food",
      ctx({ transcript: null, siteText: "full recipe from the linked site" }),
      { anthropic }
    );

    expect(result).toBeDefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("returns undefined for steps/design templates when there is no transcript or caption", async () => {
    const { anthropic, create } = fakeAnthropic("unused");

    const result = await buildContentNotes(
      "Trading",
      ctx({ transcript: null, caption: "" }),
      { anthropic }
    );

    expect(result).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
});
