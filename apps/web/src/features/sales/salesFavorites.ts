// Favourites used to live per browser; the site's quick keys replace them and
// these entries are only read once to seed a site that has no keys yet.
const STORAGE_PREFIX = 'puntovivo:sales-favorites:v1';

function storageKey(scopeKey: string): string {
  return `${STORAGE_PREFIX}:${scopeKey}`;
}

export function readSalesFavoriteIds(scopeKey: string): string[] | null {
  if (!scopeKey) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(scopeKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { productIds?: unknown };
    if (!Array.isArray(parsed.productIds)) return null;
    return parsed.productIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return null;
  }
}

export function clearSalesFavoriteIds(scopeKey: string): void {
  try {
    window.localStorage.removeItem(storageKey(scopeKey));
  } catch {
    // Without storage there is nothing left to import.
  }
}

const DISMISSED_PREFIX = 'puntovivo:sales-favorite-suggestions-dismissed:v1';

export function readDismissedSuggestions(scopeKey: string): string[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(`${DISMISSED_PREFIX}:${scopeKey}`) ?? '[]'
    );
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function writeDismissedSuggestions(scopeKey: string, productIds: readonly string[]): void {
  try {
    window.localStorage.setItem(`${DISMISSED_PREFIX}:${scopeKey}`, JSON.stringify(productIds));
  } catch {
    // Without storage the dismissal lasts until the next reload.
  }
}
