import { describe, it, expect, vi } from "vitest";
import { buildZettelkastenNotes } from "../src/zettelkasten.js";

describe("buildZettelkastenNotes", () => {
  it("sends the transcript and source context to Claude and returns the note text", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: "### 1. Literature Note\nSome literature note text.",
        },
      ],
    });
    const fakeAnthropic = { messages: { create } } as any;

    const notes = await buildZettelkastenNotes(
      {
        transcript: "today we're talking about deep work",
        sourceUrl: "https://www.instagram.com/reel/abc123/",
        reelTitle: "Deep Work Tips",
        uploader: "productivityguru",
      },
      { anthropic: fakeAnthropic }
    );

    expect(notes).toBe("### 1. Literature Note\nSome literature note text.");
    expect(create).toHaveBeenCalledTimes(1);
    const callArgs = create.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("today we're talking about deep work");
    expect(callArgs.messages[0].content).toContain("https://www.instagram.com/reel/abc123/");
    expect(callArgs.messages[0].content).toContain("productivityguru");
    expect(callArgs.messages[0].content).toContain("Deep Work Tips");
    expect(callArgs.messages[0].content).toContain("LITERATURE NOTE");
    expect(callArgs.messages[0].content).toContain("PERMANENT NOTES");
  });

  it("falls back to 'unknown'/'not available' when uploader/title are missing", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "notes" }],
    });
    const fakeAnthropic = { messages: { create } } as any;

    await buildZettelkastenNotes(
      { transcript: "content", sourceUrl: "https://www.instagram.com/reel/abc/", reelTitle: "", uploader: "" },
      { anthropic: fakeAnthropic }
    );

    const callArgs = create.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("unknown");
    expect(callArgs.messages[0].content).toContain("not available");
  });

  it("throws when Claude's response has no text block", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "image" }] });
    const fakeAnthropic = { messages: { create } } as any;

    await expect(
      buildZettelkastenNotes(
        { transcript: "content", sourceUrl: "https://www.instagram.com/reel/abc/", reelTitle: "", uploader: "" },
        { anthropic: fakeAnthropic }
      )
    ).rejects.toThrow(/did not contain a text block/);
  });
});
