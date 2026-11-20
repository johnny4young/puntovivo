import { keepPreviousData } from '@tanstack/react-query';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';

const RESULT_LIMIT = 6;

export interface CommandBarCustomer {
  id: string;
  name: string;
  /** Document or phone, whichever helps tell two namesakes apart. */
  detail: string | null;
}

/** Active customers matching what follows `@`; nothing is fetched until text is typed. */
export function useCommandBarCustomers(query: string, enabled: boolean) {
  const debounced = useDebouncedValue(query.trim(), 200);
  const canSearch = enabled && debounced.length > 0;
  const search = trpc.customers.search.useQuery(
    { q: debounced, limit: RESULT_LIMIT, isActive: true },
    { enabled: canSearch, placeholderData: keepPreviousData, staleTime: 30_000 }
  );
  const customers: CommandBarCustomer[] = canSearch
    ? (search.data?.items ?? []).map(customer => ({
        id: customer.id,
        name: customer.name,
        detail: customer.taxId ?? customer.phone ?? null,
      }))
    : [];
  return { customers, isLoading: canSearch && search.isFetching && !search.data };
}
