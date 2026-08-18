import type { Category } from "./types.js";

export const CATEGORIES: readonly Category[] = [
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
];

export function normalizeCategory(value: string): Category {
  const match = CATEGORIES.find(
    (c) => c.toLowerCase() === value.trim().toLowerCase()
  );
  return match ?? "Other";
}

// Distinct black/monochrome Notion page icons per category, so pages are
// visually scannable in a database view without relying on color.
const CATEGORY_ICONS: Record<Category, string> = {
  "Recipes/Food": "⬛",
  "Fitness/Health": "◼️",
  "Business/Ideas": "▪️",
  "Learning/Tech": "◾",
  Travel: "🔲",
  "Quotes/Inspiration": "🔳",
  "Entertainment/Humor": "⚫",
  Trading: "♠️",
  "Claude Hacks": "♣️",
  "Parenting Hacks": "⌛",
  "Design Hacks": "✒️",
  "Design Inspiration": "✂️",
  Other: "⬛",
};

export function getCategoryIcon(category: Category): string {
  return CATEGORY_ICONS[category] ?? "⬛";
}
