import { describe, it, expect, vi } from "vitest";
import { extractKeyItems } from "../src/keyItems.js";

describe("extractKeyItems", () => {
  it("parses a JSON array of item names from Claude's response", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(["Ponytail", "Claude Mem", "Obsidian skill"]) }],
    });
    const fakeAnthropic = { messages: { create } } as any;

    const items = await extractKeyItems(
      { transcript: "five tools: Ponytail, Claude Mem, Obsidian skill", caption: "" },
      { anthropic: fakeAnthropic }
    );

    expect(items).toEqual(["Ponytail", "Claude Mem", "Obsidian skill"]);
  });

  it("returns an empty array when there is no list", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "[]" }] });
    const fakeAnthropic = { messages: { create } } as any;

    const items = await extractKeyItems(
      { transcript: "just a narrative story with no list", caption: "" },
      { anthropic: fakeAnthropic }
    );

    expect(items).toEqual([]);
  });

  it("strips a markdown code fence before parsing", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: '```json\n["Bollinger Bands", "Stochastic Oscillator"]\n```' }],
    });
    const fakeAnthropic = { messages: { create } } as any;

    const items = await extractKeyItems(
      { transcript: "combining Bollinger Bands with the Stochastic Oscillator", caption: "" },
      { anthropic: fakeAnthropic }
    );

    expect(items).toEqual(["Bollinger Bands", "Stochastic Oscillator"]);
  });

  it("returns an empty array on invalid JSON instead of throwing", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "not json" }] });
    const fakeAnthropic = { messages: { create } } as any;

    const items = await extractKeyItems(
      { transcript: "content", caption: "" },
      { anthropic: fakeAnthropic }
    );

    expect(items).toEqual([]);
  });

  it("skips the API call entirely when there is no transcript or caption", async () => {
    const create = vi.fn();
    const fakeAnthropic = { messages: { create } } as any;

    const items = await extractKeyItems({ transcript: null, caption: "" }, { anthropic: fakeAnthropic });

    expect(items).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});
