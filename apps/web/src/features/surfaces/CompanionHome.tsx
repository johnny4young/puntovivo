import { lazy, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  ShoppingBag,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { trpc } from '@/lib/trpc';
import { calendarDayAt, formatCurrency, formatDateTime } from '@/lib/utils';
import { CompanionConnection } from './CompanionConnection';
import { CompanionMore } from './CompanionMore';
import { isCompanionOwner, parseCompanionView } from './companionViews';
import {
  SALES_INVALIDATION_THROTTLE_MS,
  useCompanionLive,
  type LiveState,
  type RefreshScope,
} from './useCompanionLive';

const SNAPSHOT_REFRESH_INTERVAL_MS = 30_000;

// Viewers never download the owner's screens.
const CompanionOwnerViews = lazy(() =>
  import('./CompanionOwnerViews').then(module => ({ default: module.CompanionOwnerViews }))
);

type CompanionSnapshotData = inferRouterOutputs<AppRouter>['companion']['snapshot'];

/** Installable phone surface: the owner's day for admins and managers, a read-only pulse for viewers. */
export function CompanionHome() {
  const { user } = useAuth();
  const owner = isCompanionOwner(user?.role);
  const [searchParams] = useSearchParams();
  const view = parseCompanionView(searchParams.get('view'), owner);
  const locale = useResolvedLocale();
  // Recompute on every render so a long-lived installed surface crosses the
  // tenant's midnight without remaining pinned to yesterday.
  const today = calendarDayAt(new Date(), locale.timezone);
  const utils = trpc.useUtils();

  const refresh = useCallback(
    (scope: RefreshScope) => {
      // A failed refetch must reject so a replay gap stays visible until a read succeeds.
      const strict = { throwOnError: true } as const;
      if (!owner) return utils.companion.snapshot.invalidate({ date: today }, undefined, strict);
      const reads: Array<Promise<unknown>> = [
        utils.operations.today.invalidate(undefined, undefined, strict),
      ];
      // A sale moves Hoy and the open day only; a signed day or approval stays as it was.
      if (scope === 'sales') {
        reads.push(utils.reports.dayClose.checklist.invalidate({ date: today }, undefined, strict));
      }
      if (scope === 'operations') {
        reads.push(utils.managerApprovals.queue.invalidate(undefined, undefined, strict));
      }
      if (scope === 'all') {
        reads.push(
          utils.operations.dayCurve.invalidate(undefined, undefined, strict),
          utils.operations.morningRecap.invalidate(undefined, undefined, strict),
          utils.managerApprovals.queue.invalidate(undefined, undefined, strict),
          utils.reports.dayClose.invalidate(undefined, undefined, strict)
        );
      }
      return Promise.all(reads);
    },
    [owner, today, utils]
  );
  const reset = useCallback(() => {
    if (owner) {
      void utils.operations.today.reset();
      void utils.operations.dayCurve.reset();
      void utils.operations.morningRecap.reset();
      void utils.managerApprovals.queue.reset();
      void utils.reports.dayClose.signoff.reset();
      void utils.reports.dayClose.signoffMetadata.reset();
      void utils.reports.dayClose.checklist.reset();
    } else {
      void utils.companion.snapshot.reset({ date: today });
    }
  }, [owner, today, utils]);
  const { online, liveState } = useCompanionLive({ refresh, reset });

  if (view === 'more') return <CompanionMore />;
  if (!online) return <OfflineNotice />;
  return owner ? (
    <CompanionOwnerViews view={view} liveState={liveState} businessDay={today} />
  ) : (
    <CompanionPulse liveState={liveState} date={today} />
  );
}

function OfflineNotice() {
  const { t } = useTranslation('companion');
  return (
    <section
      className="card space-y-2 border-warning-300 bg-warning-50 p-4"
      data-testid="companion-offline"
      role="status"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-warning-900">
        <WifiOff className="h-4 w-4" aria-hidden="true" />
        {t('offline.title')}
      </h2>
      <p className="text-sm text-warning-800">{t('offline.description')}</p>
    </section>
  );
}

/** The viewer's read-only pulse backed by one minimal snapshot. */
function CompanionPulse({ liveState, date }: { liveState: LiveState; date: string }) {
  const { t } = useTranslation('companion');
  const snapshotQuery = trpc.companion.snapshot.useQuery(
    { date },
    { staleTime: SALES_INVALIDATION_THROTTLE_MS, refetchInterval: SNAPSHOT_REFRESH_INTERVAL_MS }
  );

  return (
    <div className="space-y-5" data-testid="companion-home">
      <header className="space-y-1">
        <p className="pv-kicker">{t('kicker')}</p>
        <h1 className="pv-title text-xl">{t('title')}</h1>
        <CompanionConnection liveState={liveState} />
      </header>

      {snapshotQuery.isPending ? (
        <section className="card flex items-center gap-2 p-4 text-sm text-secondary-500">
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('snapshot.loading')}
        </section>
      ) : snapshotQuery.isError || !snapshotQuery.data ? (
        <section className="card space-y-2 border-danger-300 bg-danger-50 p-4" role="alert">
          <h2 className="text-sm font-semibold text-danger-700">{t('snapshot.unavailable')}</h2>
          <p className="text-sm text-danger-700">{t('snapshot.unavailableHint')}</p>
        </section>
      ) : (
        <CompanionSnapshot data={snapshotQuery.data} />
      )}
    </div>
  );
}

function CompanionSnapshot({ data }: { data: CompanionSnapshotData }) {
  const { t } = useTranslation('companion');
  return (
    <>
      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-secondary-600">{t('today.title')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-secondary-500">{t('today.revenue')}</p>
            <p
              className="text-2xl font-semibold text-secondary-950"
              data-testid="companion-revenue"
            >
              {formatCurrency(data.stats.revenue)}
            </p>
          </div>
          <div>
            <p className="text-xs text-secondary-500">{t('today.orders')}</p>
            <p className="text-2xl font-semibold text-secondary-950">{data.stats.orders}</p>
          </div>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-secondary-600">
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
          {t('dayClose.title')}
        </h2>
        {data.dayClose ? (
          <div data-testid="companion-day-close-signed">
            <p className="flex items-center gap-2 text-sm font-semibold text-success-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {t('dayClose.signed')}
            </p>
            <p className="text-xs text-secondary-500">
              {t('dayClose.signedBy', {
                name: data.dayClose.signedBy.name,
                time: formatDateTime(data.dayClose.signedAt),
              })}
            </p>
          </div>
        ) : (
          <div data-testid="companion-day-close-pending">
            <p className="text-sm font-semibold text-secondary-950">{t('dayClose.pending')}</p>
            <p className="text-xs text-secondary-500">{t('dayClose.pendingHint')}</p>
          </div>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-secondary-600">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {t('attention.title')}
        </h2>
        {data.attention.totalCount > 0 ? (
          <ul className="space-y-2" data-testid="companion-attention-list">
            {data.attention.areas.map(area => (
              <li
                key={area.area}
                className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm ${
                  area.severity === 'danger'
                    ? 'border-danger-300/70 bg-danger-50 text-danger-700'
                    : 'border-warning-300/70 bg-warning-50 text-warning-900'
                }`}
              >
                <span>{t(`attention.areas.${area.area}`)}</span>
                <strong>{area.count}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-success-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {t('attention.clear')}
          </p>
        )}
        <p className="text-xs text-secondary-500">{t('attention.readOnly')}</p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-secondary-600">
          <ShoppingBag className="h-4 w-4" aria-hidden="true" />
          {t('ticker.title')}
        </h2>
        {data.recentSales.length === 0 ? (
          <p className="text-sm text-secondary-500">{t('ticker.empty')}</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="companion-ticker">
            {data.recentSales.map(sale => (
              <li key={sale.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-secondary-900">{sale.saleNumber}</p>
                  <p className="text-xs text-secondary-500">{formatDateTime(sale.completedAt)}</p>
                </div>
                <strong className="shrink-0 text-sm text-secondary-950">
                  {formatCurrency(sale.total)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
