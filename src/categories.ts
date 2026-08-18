import type { Category } from "./types.js";

export const CATEGORIES: readonly Category[] = [
  "Recipes/Food",
  "Fitness/Health",
  "Business/Ideas",
  "Learning/Tech",
  "Travel",
  "Quotes/Inspiration",
  "Entertainment/Humor",
  "Other",
];

export function normalizeCategory(value: string): Category {
  const match = CATEGORIES.find(
    (c) => c.toLowerCase() === value.trim().toLowerCase()
  );
  return match ?? "Other";
}
