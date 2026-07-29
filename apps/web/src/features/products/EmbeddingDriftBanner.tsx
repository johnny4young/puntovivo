/**
 * admin banner that surfaces `products.embedding_model`
 * drift on the Products page. Hidden entirely when:
 * - the `semantic-search` module is off,
 * - AI is disabled or the active provider does not embed
 * (`mode === 'unavailable'`),
 * - the catalog is aligned (`staleCount === 0`).
 *
 * Managers see the banner as a read-only nudge. Only admins get the
 * "Regenerate embeddings" CTA — the underlying
 * `products.regenerateEmbeddings` mutation is `adminProcedureWithModule`
 * so the server enforces the same gate regardless of UI state.
 */
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { PrimaryTaskButton, PrioritizedBanner } from '@/components/experience';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

type EmbeddingHealth = inferRouterOutputs<AppRouter>['products']['embeddingHealth'];

interface EmbeddingDriftBannerProps {
  /**
   * The latest `products.embeddingHealth` query response. Pass `null`
   * while the parent is still loading the query — the banner renders
   * nothing in that case, which keeps the ProductsPage layout stable
   * across the boot path.
   */
  data: EmbeddingHealth | null | undefined;
}

export function EmbeddingDriftBanner({ data }: EmbeddingDriftBannerProps) {
  const { t } = useTranslation(['products', 'errors']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const canRegenerate = user?.role === 'admin';

  const regenerateMutation = trpc.products.regenerateEmbeddings.useMutation({
    onSuccess: async result => {
      if (!result.ok) {
        toast.warning({ title: t('semantic.regenerateUnavailable') });
        return;
      }
      toast.success({
        title: t('semantic.regenerated', { count: result.embedded }),
      });
      await Promise.all([
        utils.products.embeddingHealth.invalidate(),
        utils.products.semanticSearch.invalidate(),
      ]);
    },
    onError: onErrorToast(toast, t, { titleKey: 'products:semantic.regenerateError' }),
  });

  // The outer live-region shell stays in the DOM whenever the parent
  // is past loading (data !== null), so screen readers track the
  // banner as it appears / disappears. Returning a bare null until the
  // first available payload would silently swallow the announcement —
  // `aria-live` only fires for changes inside a region that was
  // already attached. The shell is visually empty when there is no
  // drift to surface.
  if (!data) return null;

  const shouldShow = data.mode === 'available' && data.staleCount > 0;

  // Always non-empty when shouldShow: the server only fills sample ids
  // when there is drift. Fall back to the semantic-mode badge label if
  // a future provider returns more than the cap with empty distincts.
  const modelsLabel =
    shouldShow && data.staleSampleModelIds.length > 0
      ? data.staleSampleModelIds.join(', ')
      : t('semantic.modeBadge');

  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {shouldShow && (
        <PrioritizedBanner
          icon={AlertTriangle}
          eyebrow={t('embeddingDrift.eyebrow')}
          title={t('embeddingDrift.title')}
          description={t('embeddingDrift.description')}
          tone="warning"
          testId="embedding-drift-banner"
          meta={
            <span className="inline-flex min-h-9 items-center rounded-full border border-warning-200 bg-warning-50 px-3 text-xs font-semibold text-warning-800">
              {t('embeddingDrift.count', { count: data.staleCount })}
            </span>
          }
          action={
            canRegenerate ? (
              <PrimaryTaskButton
                type="button"
                onClick={() => regenerateMutation.mutate()}
                disabled={regenerateMutation.isPending}
                aria-busy={regenerateMutation.isPending}
                className="w-full sm:w-auto"
                data-testid="embedding-drift-regenerate"
              >
                <RefreshCw
                  className={regenerateMutation.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
                  aria-hidden="true"
                />
                {regenerateMutation.isPending
                  ? t('embeddingDrift.regenerating')
                  : t('embeddingDrift.regenerateCta')}
              </PrimaryTaskButton>
            ) : undefined
          }
          details={
            canRegenerate ? (
              <details className="text-xs text-secondary-600">
                <summary className="w-fit cursor-pointer font-semibold text-secondary-800">
                  {t('embeddingDrift.technicalDetails')}
                </summary>
                <p className="mt-1.5">
                  {t('embeddingDrift.sampleModelsHint', {
                    count: data.staleCount,
                    models: modelsLabel,
                  })}
                </p>
              </details>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
