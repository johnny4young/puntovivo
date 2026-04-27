/**
 * Receipt template variable availability hook (ENG-016 pass 5).
 *
 * Thin wrapper around the `receiptTemplates.variableAvailability` tRPC
 * query. The endpoint is admin-only and reads two rows from the DB
 * (the active tenant's company + tenants.settings), so it's cheap to
 * call on editor mount; we use a long staleTime so the editor doesn't
 * refetch on every keystroke.
 *
 * @module features/receipt-templates/templateAvailability
 */

import { trpc } from '@/lib/trpc';
import type { AvailabilityMap } from './templateUnavailableDecorations';

const ONE_MINUTE = 60 * 1000;

interface UseVariableAvailabilityResult {
  /** Map keyed by namespace → property → boolean. `null` while loading. */
  availability: AvailabilityMap | null;
  /** True until the first response (or error) lands. */
  isLoading: boolean;
  /** Set when the underlying tRPC query failed. */
  error: unknown;
}

/**
 * Returns the per-tenant availability map for the documented template
 * variable namespaces. Returns `null` while the request is in flight
 * so the editor can fall back to "everything available" — better UX
 * than flashing dim styles on first paint and then un-dimming once
 * the response arrives.
 */
export function useVariableAvailability(
  options: { enabled?: boolean } = {}
): UseVariableAvailabilityResult {
  const enabled = options.enabled !== false;
  const query = trpc.receiptTemplates.variableAvailability.useQuery(undefined, {
    enabled,
    staleTime: ONE_MINUTE,
    refetchOnWindowFocus: false,
  });
  return {
    availability: (query.data as AvailabilityMap | undefined) ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}
