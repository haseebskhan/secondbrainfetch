import { describe, it, expect, vi } from "vitest";
import { extractExternalUrl, fetchWebpageText } from "../src/webfetch.js";

describe("extractExternalUrl", () => {
  it("finds a non-Instagram URL in a caption", () => {
    expect(extractExternalUrl("Full recipe at https://example.com/recipe/pasta - enjoy!")).toBe(
      "https://example.com/recipe/pasta"
    );
  });

  it("ignores Instagram URLs", () => {
    expect(extractExternalUrl("check my other reel https://www.instagram.com/reel/xyz/")).toBeNull();
  });

  it("returns null when there is no URL", () => {
    expect(extractExternalUrl("just a plain caption, no links here")).toBeNull();
  });

  it("strips trailing punctuation from the matched URL", () => {
    expect(extractExternalUrl("recipe here: https://example.com/recipe.")).toBe(
      "https://example.com/recipe"
    );
  });
});

describe("fetchWebpageText", () => {
  it("strips HTML tags/scripts and returns plain text", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: vi
        .fn()
        .mockResolvedValue(
          "<html><head><style>.a{}</style></head><body><script>evil()</script><h1>Pasta Recipe</h1><p>Boil water &amp; add salt</p></body></html>"
        ),
    });

    const text = await fetchWebpageText("https://example.com/recipe", { fetchFn: fetchFn as any });

    expect(text).toContain("Pasta Recipe");
    expect(text).toContain("Boil water & add salt");
    expect(text).not.toContain("evil()");
    expect(text).not.toContain("<h1>");
  });

  it("throws a descriptive error on a non-OK response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404, text: vi.fn() });

    await expect(
      fetchWebpageText("https://example.com/missing", { fetchFn: fetchFn as any })
    ).rejects.toThrow(/404/);
  });

  it("truncates very long pages", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(`<p>${"word ".repeat(3000)}</p>`),
    });

    const text = await fetchWebpageText("https://example.com/long", { fetchFn: fetchFn as any });

    expect(text.length).toBeLessThanOrEqual(6000);
  });
});
