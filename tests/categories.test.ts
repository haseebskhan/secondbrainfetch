import { describe, it, expect } from "vitest";
import { CATEGORIES, normalizeCategory, getCategoryIconUrl } from "../src/categories.js";

describe("CATEGORIES", () => {
  it("contains the 13 fixed categories in order", () => {
    expect(CATEGORIES).toEqual([
      "Recipes/Food",
      "Fitness/Health",
      "Business/Ideas",
      "Learning/Tech",
      "Travel",
      "Quotes/Inspiration",
      "Entertainment/Humor",
      "Trading",
      "Claude Hacks",
      "Parenting Hacks",
      "Design Hacks",
      "Design Inspiration",
      "Other",
    ]);
  });
});

describe("normalizeCategory", () => {
  it("returns an exact match unchanged", () => {
    expect(normalizeCategory("Travel")).toBe("Travel");
  });

  it("matches case-insensitively", () => {
    expect(normalizeCategory("travel")).toBe("Travel");
  });

  it("matches a new category case-insensitively", () => {
    expect(normalizeCategory("trading")).toBe("Trading");
  });

  it("falls back to Other for an unrecognized value", () => {
    expect(normalizeCategory("Cryptocurrency")).toBe("Other");
  });

  it("falls back to Other for an empty string", () => {
    expect(normalizeCategory("")).toBe("Other");
  });
});

describe("getCategoryIconUrl", () => {
  it("returns a distinct Phosphor CDN URL for every category", () => {
    const urls = CATEGORIES.map((c) => getCategoryIconUrl(c));
    expect(new Set(urls).size).toBe(CATEGORIES.length);
    for (const url of urls) {
      expect(url).toMatch(
        /^https:\/\/cdn\.jsdelivr\.net\/npm\/@phosphor-icons\/core@2\/assets\/fill\/[a-z-]+-fill\.svg$/
      );
    }
  });

  it("returns the expected icon for Recipes/Food", () => {
    expect(getCategoryIconUrl("Recipes/Food")).toBe(
      "https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2/assets/fill/bowl-food-fill.svg"
    );
  });
});
