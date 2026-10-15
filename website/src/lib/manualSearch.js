/** Accent-insensitive AND search; no network, index download or locale fallback. */
export function normalizeSearch(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function matchesSearch(text, query) {
  const haystack = normalizeSearch(text);
  return normalizeSearch(query)
    .split(/\s+/)
    .every(term => haystack.includes(term));
}
