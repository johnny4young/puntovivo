/** Case- and accent-insensitive form used to match labels like «devolución». */
export function normalizeForMatch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Keeps the items whose text contains every word of the query. */
export function filterByQuery<T>(items: readonly T[], query: string, text: (item: T) => string) {
  const words = normalizeForMatch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter(item => {
    const haystack = normalizeForMatch(text(item));
    return words.every(word => haystack.includes(word));
  });
}
