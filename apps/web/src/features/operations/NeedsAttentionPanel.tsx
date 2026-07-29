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
import { Badge, Button } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
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
            const severityVariant = area.severity === 'danger' ? 'danger' : 'warning';
            return (
              <article
                key={area.area}
                className="overflow-hidden rounded-2xl border border-line bg-card"
                data-testid={`needs-attention-row-${area.area}`}
                data-severity={area.severity}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/75 bg-surface-2/45 px-4 py-4 sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="pv-gt pv-gt-primary h-10 w-10 shrink-0 rounded-xl">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-secondary-950">{areaLabel}</h3>
                      <p className="mt-0.5 text-sm text-secondary-600">
                        {t('attention.count', { count: area.count })}
                      </p>
                    </div>
                  </div>
                  <Badge variant={severityVariant} marker="dot">
                    {t(`attention.severity.${area.severity}`)}
                  </Badge>
                </div>

                <dl className="grid gap-px bg-line/70 sm:grid-cols-2">
                  {(['impact', 'saleSafety', 'recommendation', 'approval'] as const).map(field => (
                    <div key={field} className="min-w-0 bg-card px-4 py-4 sm:px-5">
                      <dt className="pv-kicker">{t(`attention.labels.${field}`)}</dt>
                      <dd className="mt-1.5 text-sm leading-6 text-secondary-700">
                        {field === 'approval'
                          ? t('attention.approval.administrator')
                          : t(`attention.${field}.${area.area}`)}
                      </dd>
                    </div>
                  ))}
                </dl>

                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line/75 px-4 py-4 sm:px-5">
                  <p className="max-w-2xl text-xs leading-5 text-secondary-500">
                    {t(`attention.assurance.${area.area}`)}
                  </p>
                  {isAdmin ? (
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
                  ) : (
                    <Badge
                      variant="outline"
                      className="max-w-full text-center"
                      data-testid={`needs-attention-handoff-${area.area}`}
                    >
                      {t('attention.handoff')}
                    </Badge>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
