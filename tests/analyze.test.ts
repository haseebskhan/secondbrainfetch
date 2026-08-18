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
            summary: "A quick 3-ingredient weeknight pasta recipe.",
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
      summary: "A quick 3-ingredient weeknight pasta recipe.",
      category: "Recipes/Food",
      tags: ["pasta", "quick meals"],
    });
  });

  it("defaults summary to an empty string when Claude omits it", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            title: "No Summary Given",
            category: "Other",
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

    expect(result.summary).toBe("");
  });

  it("normalizes a category Claude returns outside the fixed list to Other", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            title: "Random Clip",
            summary: "Unclear content.",
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
              summary: "Claude wrapped this in a code fence.",
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
