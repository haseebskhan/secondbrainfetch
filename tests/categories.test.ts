import { describe, it, expect } from "vitest";
import { CATEGORIES, normalizeCategory } from "../src/categories.js";

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
