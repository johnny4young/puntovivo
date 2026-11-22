const CATEGORY_HUES = [250, 200, 150, 95, 55, 25, 340, 295] as const;

/** Stable tile hue per category, so a category reads the same on every register. */
export function categoryHue(categoryId: string | null | undefined): number {
  if (!categoryId) return CATEGORY_HUES[0];
  let hash = 0;
  for (const char of categoryId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return CATEGORY_HUES[Math.abs(hash) % CATEGORY_HUES.length] ?? CATEGORY_HUES[0];
}
