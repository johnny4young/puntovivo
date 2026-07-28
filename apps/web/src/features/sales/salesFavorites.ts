const STORAGE_PREFIX = 'puntovivo:sales-favorites:v1';
export const MAX_SALES_FAVORITES = 8;

interface FavoritePayload {
  productIds: string[];
}

function storageKey(scopeKey: string): string {
  return `${STORAGE_PREFIX}:${scopeKey}`;
}

export function readSalesFavoriteIds(scopeKey: string): string[] | null {
  if (!scopeKey) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(scopeKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FavoritePayload>;
    if (!Array.isArray(parsed.productIds)) return null;
    return parsed.productIds
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .slice(0, MAX_SALES_FAVORITES);
  } catch {
    return null;
  }
}

export function writeSalesFavoriteIds(scopeKey: string, productIds: readonly string[]): void {
  if (!scopeKey) return;
  const uniqueIds = [...new Set(productIds)].slice(0, MAX_SALES_FAVORITES);
  try {
    window.localStorage.setItem(
      storageKey(scopeKey),
      JSON.stringify({ productIds: uniqueIds } satisfies FavoritePayload)
    );
  } catch {
    // Storage may be unavailable in private mode. The current in-memory
    // selection remains usable; only persistence is skipped.
  }
}

export function toggleSalesFavoriteId(
  current: readonly string[],
  productId: string
): string[] {
  if (current.includes(productId)) {
    return current.filter(id => id !== productId);
  }
  if (current.length >= MAX_SALES_FAVORITES) {
    return [...current];
  }
  return [...current, productId];
}
