/**
 * Operations "Needs attention" panel.
 *
 * The default Operations landing: a single glance at the retryable
 * failures across sync / fiscal / hardware / payments, each row
 * deep-linking to the surface that actually resolves it. Fiscal, hardware,
 * and payments stay inside Operations; sync routes to Company → Data because
 * the Operations sync panel is intentionally diagnostic-only. When nothing
 * needs attention it shows an "all clear" state. The
 * counts come from one aggregation query (`operations.needsAttention`),
 * so the landing does not fan out across every per-panel query.
 *
 * @module features/operations/NeedsAttentionPanel
 */
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  CreditCard,
  Landmark,
  Printer,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState } from '@/components/feedback/EmptyState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { StatusStrip, Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';

/**
 * The four retryable failure surfaces the queue covers. Fiscal, device, and
 * payments are Operations tabs; sync intentionally routes to Company → Data.
 * Kept in lockstep with the server enum
 * (`services/operations/attention.ts`).
 */
export type NeedsAttentionArea = 'sync' | 'fiscal' | 'device' | 'payments';
interface NeedsAttentionPanelProps {
  /** Switches the Operations tab to the panel that resolves the area. */
  onReviewArea: (area: NeedsAttentionArea) => void;
  /** Navigates to recovery surfaces that intentionally live outside Operations. */
  onNavigate: (target: string) => void;
}
const AREA_ICONS: Record<NeedsAttentionArea, LucideIcon> = {
  sync: RefreshCw,
  fiscal: Landmark,
  device: Printer,
  payments: CreditCard,
};
export function NeedsAttentionPanel({ onReviewArea, onNavigate }: NeedsAttentionPanelProps) {
  const { t } = useTranslation(['operations', 'errors']);
  const query = trpc.operations.needsAttention.useQuery(undefined, {
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  return (
    <section className="card p-5 sm:p-6" data-testid="needs-attention-panel">
      <header className="mb-5">
        <p className="pv-kicker">{t('attention.kicker')}</p>
        <h2 className="pv-title text-xl">{t('attention.title')}</h2>
        <p className="mt-2 text-sm text-secondary-600">{t('attention.description')}</p>
      </header>

      {query.isLoading && (
        <div className="space-y-3" data-testid="needs-attention-loading" aria-hidden="true">
          {[0, 1].map(i => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-secondary-100/70" />
          ))}
        </div>
      )}

      {query.isError && (
        <QueryErrorState
          title={t('attention.error.title')}
          message={translateServerError(query.error, t, t('errors:server.unknown'))}
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
              <StatusStrip
                key={area.area}
                tone={area.severity === 'danger' ? 'danger' : 'warning'}
                icon={Icon}
                title={areaLabel}
                data-testid={`needs-attention-row-${area.area}`}
                data-severity={area.severity}
                action={
                  <Button
                    type="button"
                    className="shrink-0"
                    onClick={() => {
                      if (area.area === 'sync') onNavigate('/company?tab=data');
                      else onReviewArea(area.area);
                    }}
                    data-testid={`needs-attention-cta-${area.area}`}
                    aria-label={t('attention.actionAria', {
                      action: t(`attention.action.${area.area}`),
                      area: areaLabel,
                    })}
                    variant="outline"
                  >
                    {t(`attention.action.${area.area}`)}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                }
              >
                <span className="block text-secondary-600">
                  {t('attention.count', {
                    count: area.count,
                  })}
                </span>
              </StatusStrip>
            );
          })}
        </div>
      )}
    </section>
  );
}
