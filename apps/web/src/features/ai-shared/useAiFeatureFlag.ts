import { useMemo } from 'react';
import { trpc } from '@/lib/trpc';

export type AiFeatureKey = 'copilot' | 'anomalies' | 'semanticSearch' | 'invoiceOcr';

interface UseAiFeatureFlagResult {
  enabled: boolean;
  isLoading: boolean;
}

/**
 * Reads `tenants.settings.ai.features.<key>.enabled` via `trpc.ai.settings.get`.
 *
 * Returns `false` while the query is loading or when the tenant has not
 * activated the feature. The query is cached at the React Query layer,
 * so multiple callers (PurchasesPage button gate, CopilotPage entry,
 * AnomaliesCard dashboard tile, ProductsPage toggle) share a single
 * round-trip per session.
 *
 * Added 2026-05-15 per AI Núcleo handoff §1.5 — `useAiFeatureFlag('invoiceOcr')`.
 */
export function useAiFeatureFlag(feature: AiFeatureKey): UseAiFeatureFlagResult {
  const query = trpc.ai.settings.get.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    const features = (query.data?.features ?? null) as
      | Record<string, { enabled?: boolean }>
      | null;
    const enabled = Boolean(query.data?.enabled) && Boolean(features?.[feature]?.enabled);
    return { enabled, isLoading: query.isLoading };
  }, [query.data, query.isLoading, feature]);
}
