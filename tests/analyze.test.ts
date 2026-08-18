import { describe, it, expect, vi } from "vitest";
import { analyzeContent } from "../src/analyze.js";

describe("analyzeContent", () => {
  it("parses Claude's JSON response into an AnalysisResult", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            title: "3-Ingredient Pasta",
            visualDescription: "A stovetop pasta being tossed with garlic and olive oil.",
            ideas: "Try swapping the pasta for zucchini noodles for a lower-carb version.",
            category: "Recipes/Food",
            tags: ["pasta", "quick meals"],
          }),
        },
      ],
    });
    const fakeAnthropic = { messages: { create } } as any;

    const result = await analyzeContent(
      { transcript: "today we're making pasta", frames: [Buffer.from("img")] },
      { anthropic: fakeAnthropic }
    );

    expect(result).toEqual({
      title: "3-Ingredient Pasta",
      visualDescription: "A stovetop pasta being tossed with garlic and olive oil.",
      ideas: "Try swapping the pasta for zucchini noodles for a lower-carb version.",
      category: "Recipes/Food",
      tags: ["pasta", "quick meals"],
    });
  });

  it("normalizes a category Claude returns outside the fixed list to Other", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            title: "Random Clip",
            visualDescription: "Unclear content.",
            ideas: "No clear ideas to extend.",
            category: "Cryptocurrency",
            tags: [],
          }),
        },
      ],
    });
    const fakeAnthropic = { messages: { create } } as any;

    const result = await analyzeContent(
      { transcript: null, frames: [] },
      { anthropic: fakeAnthropic }
    );

    expect(result.category).toBe("Other");
  });

  it("strips a markdown JSON code fence before parsing", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text:
            "```json\n" +
            JSON.stringify({
              title: "Fenced Response",
              visualDescription: "Claude wrapped this in a code fence.",
              ideas: "An idea inspired by the fenced content.",
              category: "Other",
              tags: [],
            }) +
            "\n```",
        },
      ],
    });
    const fakeAnthropic = { messages: { create } } as any;

    const result = await analyzeContent(
      { transcript: null, frames: [] },
      { anthropic: fakeAnthropic }
    );

    expect(result.title).toBe("Fenced Response");
  });
});
