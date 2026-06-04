/**
 * ENG-187 — Operations "Needs attention" panel.
 *
 * The default Operations landing: a single glance at the retryable
 * failures across sync / fiscal / hardware / payments, each row
 * deep-linking (via `onReviewArea`) to the per-surface tab that resolves
 * it. When nothing needs attention it shows an "all clear" state. The
 * counts come from one aggregation query (`operations.needsAttention`),
 * so the landing does not fan out across every per-panel query.
 *
 * @module features/operations/NeedsAttentionPanel
 */
import type { ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  CreditCard,
  Landmark,
  Printer,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { EmptyState } from '@/components/feedback/EmptyState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { cn } from '@/lib/utils';

/**
 * The four retryable failure surfaces the queue covers. Each value is
 * ALSO an Operations `?tab=` key, so the row CTA can switch straight to
 * the resolving panel. Kept in lockstep with the server enum
 * (`services/operations/attention.ts`) and `OperationsPage` `TAB_KEYS`.
 */
export type NeedsAttentionArea = 'sync' | 'fiscal' | 'device' | 'payments';

interface NeedsAttentionPanelProps {
  /** Switches the Operations tab to the panel that resolves the area. */
  onReviewArea: (area: NeedsAttentionArea) => void;
}

const AREA_ICONS: Record<NeedsAttentionArea, ElementType> = {
  sync: RefreshCw,
  fiscal: Landmark,
  device: Printer,
  payments: CreditCard,
};

export function NeedsAttentionPanel({ onReviewArea }: NeedsAttentionPanelProps) {
  const { t } = useTranslation(['operations', 'errors']);
  const query = trpc.operations.needsAttention.useQuery(undefined, {
    staleTime: 15_000,
  });

  return (
    <section className="card p-5 sm:p-6" data-testid="needs-attention-panel">
      <header className="mb-5">
        <p className="pv-kicker">{t('attention.kicker')}</p>
        <h2 className="pv-title text-xl">{t('attention.title')}</h2>
        <p className="mt-2 text-sm text-secondary-600">
          {t('attention.description')}
        </p>
      </header>

      {query.isLoading && (
        <div
          className="space-y-3"
          data-testid="needs-attention-loading"
          aria-hidden="true"
        >
          {[0, 1].map(i => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-2xl bg-secondary-100/70"
            />
          ))}
        </div>
      )}

      {query.isError && (
        <QueryErrorState
          title={t('attention.error.title')}
          message={translateServerError(
            query.error,
            t,
            t('errors:server.unknown')
          )}
          onRetry={() => {
            void query.refetch();
          }}
          retryLabel={t('attention.error.retry')}
        />
      )}

      {query.isSuccess && query.data.areas.length === 0 && (
        <div data-testid="needs-attention-all-clear">
          <EmptyState
            icon={ShieldCheck}
            title={t('attention.allClear.title')}
            description={t('attention.allClear.description')}
          />
        </div>
      )}

      {query.isSuccess && query.data.areas.length > 0 && (
        <div className="space-y-3" data-testid="needs-attention-list">
          {query.data.areas.map(area => {
            const Icon = AREA_ICONS[area.area];
            const areaLabel = t(`attention.area.${area.area}`);
            return (
              <div
                key={area.area}
                className={cn(
                  'pv-strip',
                  area.severity === 'danger' ? 'danger' : 'warning'
                )}
                data-testid={`needs-attention-row-${area.area}`}
                data-severity={area.severity}
              >
                <span className="ic">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="msg min-w-0 flex-1">
                  <b>{areaLabel}</b>
                  <span className="block text-secondary-600">
                    {t('attention.count', { count: area.count })}
                  </span>
                </span>
                <button
                  type="button"
                  className="pv-btn outline shrink-0"
                  onClick={() => onReviewArea(area.area)}
                  data-testid={`needs-attention-cta-${area.area}`}
                  aria-label={t('attention.reviewAria', { area: areaLabel })}
                >
                  {t('attention.reviewCta')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
