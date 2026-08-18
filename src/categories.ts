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

const PHOSPHOR_CDN = "https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2/assets/fill";

// Filled Phosphor Icons (phosphoricons.com), one per category, served as
// external image URLs — Notion's page icon API only accepts an emoji or an
// external image URL, not its own built-in icon picker.
const CATEGORY_ICON_NAMES: Record<Category, string> = {
  "Recipes/Food": "bowl-food-fill",
  "Fitness/Health": "barbell-fill",
  "Business/Ideas": "lightbulb-fill",
  "Learning/Tech": "code-fill",
  Travel: "airplane-tilt-fill",
  "Quotes/Inspiration": "quotes-fill",
  "Entertainment/Humor": "smiley-fill",
  Trading: "chart-line-up-fill",
  "Claude Hacks": "robot-fill",
  "Parenting Hacks": "baby-fill",
  "Design Hacks": "wrench-fill",
  "Design Inspiration": "palette-fill",
  Other: "bookmark-simple-fill",
};

export function getCategoryIconUrl(category: Category): string {
  const name = CATEGORY_ICON_NAMES[category] ?? CATEGORY_ICON_NAMES.Other;
  return `${PHOSPHOR_CDN}/${name}.svg`;
}
