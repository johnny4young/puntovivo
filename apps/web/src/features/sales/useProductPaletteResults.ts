import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';

const RESULT_LIMIT = 5;
const MIN_QUERY_LENGTH = 2;

/** Active products that match what is typed in the command palette. */
export function useProductPaletteResults(query: string, enabled: boolean) {
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 200);
  const canSearch = enabled && debounced.length >= MIN_QUERY_LENGTH;
  const search = trpc.products.search.useQuery(
    { q: debounced, limit: RESULT_LIMIT, isActive: true },
    { enabled: canSearch }
  );
  if (!canSearch || trimmed.length < MIN_QUERY_LENGTH) return [];
  const results = search.data;
  return Array.isArray(results) ? results : (results?.items ?? []);
}
