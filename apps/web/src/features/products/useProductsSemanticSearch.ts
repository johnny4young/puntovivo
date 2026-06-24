// ENG-048 — the ProductsPage semantic-search feature, extracted from
// ProductsPage.tsx (ENG-178 slice 32). Owns the toggle/query state, the 300ms
// debounce, the module-gate, the semanticSearch + embeddingHealth queries, and
// the regenerateEmbeddings mutation. The page keeps `products.list` (fed by
// `literalFallbackSearch`) and the trivial `displayProducts` merge — the hook
// never touches the literal product list, so there is no render cycle.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useIsModuleActive, useModulesSnapshot } from '@/features/modules';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import type { Product } from '@/types';
import type { DisplayProduct } from './productsColumns';

interface UseProductsSemanticSearchArgs {
  /** Manager+ — the semantic surface is hidden for read-only roles. */
  canManage: boolean;
  /** Admin-only — gates the regenerate-embeddings button. */
  canRegenerate: boolean;
}

/**
 * Drives the ENG-048 semantic-search surface for ProductsPage.
 *
 * Returns the toggle/input state, the module-gate flags, the debounced
 * `literalFallbackSearch` (passed to `products.list` so semantic mode still
 * narrows the literal table while a query is typed), and the ranked
 * `semanticResults` (already normalized to `DisplayProduct`). `semanticIsActive`
 * tells the page to render `semanticResults` instead of the literal list and to
 * show the "Match" column; `semanticModeEnabled` toggles the DataTable's
 * built-in search off.
 */
export function useProductsSemanticSearch({
  canManage,
  canRegenerate,
}: UseProductsSemanticSearchArgs) {
  const { t } = useTranslation(['products', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const semanticModuleActive = useIsModuleActive('semantic-search');
  const modulesSnapshot = useModulesSnapshot();
  // ENG-178 — do not trust manifest-default module state for server-gated
  // semantic procedures. A cold modules snapshot is intentionally
  // optimistic, but firing `products.embeddingHealth` before
  // `modules.getEffective` resolves makes tenants with semantic-search
  // disabled log a transient MODULE_NOT_ACTIVATED 403 in the browser
  // console. Hold the semantic surface until the authoritative snapshot
  // arrives; then the existing module flag decides visibility.
  const semanticModuleResolved = !modulesSnapshot.isPlaceholder;
  const canUseSemantic = canManage && semanticModuleResolved && semanticModuleActive;

  // ENG-048 — semantic search UI surface. The toggle flips between the
  // existing client-side text filter (DataTable's internal globalFilter
  // on the "name" column) and the server-side cosine-similarity ranking
  // exposed by `products.semanticSearch`. We debounce by 300ms so each
  // keystroke does not trigger a network roundtrip + OpenAI embed call.
  // The mutation `regenerateEmbeddings` is admin-only and is the way to
  // bring a freshly seeded catalog (or one whose products have been
  // edited heavily) up to date — the UI surfaces "X embedded" toast on
  // success and a translated warning when AI is disabled / unconfigured.
  const [semanticEnabled, setSemanticEnabled] = useState(false);
  const [semanticQuery, setSemanticQuery] = useState('');
  const [debouncedSemanticQuery, setDebouncedSemanticQuery] = useState('');
  const semanticModeEnabled = canUseSemantic && semanticEnabled;
  const literalFallbackSearch =
    semanticModeEnabled && debouncedSemanticQuery.length > 0 ? debouncedSemanticQuery : undefined;

  useEffect(() => {
    if (!semanticModeEnabled) {
      // Only schedule the reset if there is something to clear, so the
      // effect does not trigger an extra render on every disable cycle.
      if (debouncedSemanticQuery !== '') {
        const clearHandle = window.setTimeout(() => setDebouncedSemanticQuery(''), 0);
        return () => window.clearTimeout(clearHandle);
      }
      return;
    }
    const handle = window.setTimeout(() => {
      setDebouncedSemanticQuery(semanticQuery.trim());
    }, 300);
    return () => window.clearTimeout(handle);
  }, [semanticModeEnabled, semanticQuery, debouncedSemanticQuery]);

  const semanticSearchQuery = trpc.products.semanticSearch.useQuery(
    { query: debouncedSemanticQuery, limit: 25 },
    { enabled: semanticModeEnabled && debouncedSemanticQuery.length > 0 }
  );

  // ENG-040 — drift health drives the warning banner above the
  // toolbar. Gated on the same module + role surface as the rest of
  // the semantic toolbar so non-activated tenants don't fire the
  // query at all; the server also rejects with MODULE_NOT_ACTIVATED
  // if it ever sneaks through.
  const embeddingHealthQuery = trpc.products.embeddingHealth.useQuery(undefined, {
    enabled: canUseSemantic,
  });

  const regenerateMutation = trpc.products.regenerateEmbeddings.useMutation({
    onSuccess: async data => {
      if (!data.ok) {
        toast.warning({ title: t('semantic.regenerateUnavailable') });
        return;
      }
      toast.success({
        title: t('semantic.regenerated', { count: data.embedded }),
      });
      // Refresh both semantic search results and the drift banner, so the
      // existing toolbar CTA clears the same health signal as the banner CTA.
      await Promise.all([
        utils.products.embeddingHealth.invalidate(),
        utils.products.semanticSearch.invalidate(),
      ]);
    },
    onError: onErrorToast(toast, t, { titleKey: 'products:semantic.regenerateError' }),
  });

  // ENG-048 — when semantic mode is active and the server returned
  // results, replace the rendered rows; the rest of the UI keeps
  // working unchanged because the row shape matches the standard list
  // selection plus an extra optional `similarity` field.
  const semanticUnavailable =
    semanticModeEnabled && semanticSearchQuery.data?.mode === 'unavailable';
  const semanticIsActive =
    semanticModeEnabled &&
    debouncedSemanticQuery.length > 0 &&
    semanticSearchQuery.data?.mode === 'semantic';
  const semanticResults: DisplayProduct[] = useMemo(() => {
    if (!semanticIsActive) return [];
    const items =
      semanticSearchQuery.data?.mode === 'semantic' ? semanticSearchQuery.data.results : [];
    return items.map(item => {
      const normalized = {
        ...item,
        isActive: item.isActive ?? false,
        syncStatus: item.syncStatus ?? undefined,
        syncVersion: item.syncVersion ?? undefined,
      } as Product;
      return { ...normalized, similarity: item.similarity };
    });
  }, [semanticIsActive, semanticSearchQuery.data]);

  return {
    semanticEnabled,
    setSemanticEnabled,
    semanticQuery,
    setSemanticQuery,
    canUseSemantic,
    canRegenerate,
    semanticModeEnabled,
    literalFallbackSearch,
    semanticUnavailable,
    semanticIsActive,
    semanticResults,
    isSearching: semanticSearchQuery.isFetching,
    embeddingHealthData: embeddingHealthQuery.data,
    regenerate: () => regenerateMutation.mutate(),
    isRegenerating: regenerateMutation.isPending,
  };
}
