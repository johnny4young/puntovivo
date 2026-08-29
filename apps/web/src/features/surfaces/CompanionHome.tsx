import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Radio,
  RefreshCw,
  ShoppingBag,
  WifiOff,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useRealtimeChannel, type RealtimeEvent } from '@/hooks/useRealtimeChannel';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { calendarDayAt, formatCurrency, formatDateTime } from '@/lib/utils';

const SNAPSHOT_REFRESH_INTERVAL_MS = 30_000;
const SALES_INVALIDATION_THROTTLE_MS = 10_000;

type LiveState = 'connecting' | 'open' | 'closed' | 'stale' | 'offline';
type CompanionSnapshotData = inferRouterOutputs<AppRouter>['companion']['snapshot'];

function isCompanionInvalidation(
  value: unknown
): value is { scope: 'sales' | 'day_close'; changedAt: string } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.scope === 'sales' || candidate.scope === 'day_close') &&
    typeof candidate.changedAt === 'string'
  );
}

function useOnlineStatus(onOffline: () => void): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => {
      onOffline();
      setOnline(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [onOffline]);
  return online;
}

/** Viewer-safe installable phone surface backed by one minimal snapshot. */
export function CompanionHome() {
  const { t } = useTranslation('companion');
  const [replayGap, setReplayGap] = useState(false);
  const clearReplayGap = useCallback(() => setReplayGap(false), []);
  const online = useOnlineStatus(clearReplayGap);
  const [connection, setConnection] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const locale = useResolvedLocale();
  // Recompute on every query/SSE render so a long-lived installed surface
  // crosses the tenant's midnight without remaining pinned to yesterday.
  const today = calendarDayAt(new Date(), locale.timezone);
  const utils = trpc.useUtils();
  const lastSalesRefresh = useRef(0);
  const trailingRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotGeneration = useRef(0);
  const replayGapRef = useRef(false);

  const snapshotQuery = trpc.companion.snapshot.useQuery(
    { date: today },
    {
      enabled: online,
      staleTime: SALES_INVALIDATION_THROTTLE_MS,
      refetchInterval: online ? SNAPSHOT_REFRESH_INTERVAL_MS : false,
    }
  );

  const invalidateNow = useCallback(async () => {
    if (trailingRefresh.current !== null) {
      clearTimeout(trailingRefresh.current);
      trailingRefresh.current = null;
    }
    lastSalesRefresh.current = Date.now();
    const generation = snapshotGeneration.current;
    try {
      await utils.companion.snapshot.invalidate({ date: today });
      if (snapshotGeneration.current === generation) {
        replayGapRef.current = false;
        setReplayGap(false);
      }
    } catch {
      // Keep the stale/closed state visible until a later poll or event succeeds.
    }
  }, [today, utils]);

  const scheduleSalesRefresh = useCallback(() => {
    const elapsed = Date.now() - lastSalesRefresh.current;
    if (replayGapRef.current || elapsed >= SALES_INVALIDATION_THROTTLE_MS) {
      void invalidateNow();
      return;
    }
    if (trailingRefresh.current === null) {
      trailingRefresh.current = setTimeout(() => {
        trailingRefresh.current = null;
        void invalidateNow();
      }, SALES_INVALIDATION_THROTTLE_MS - elapsed);
    }
  }, [invalidateNow]);

  useEffect(
    () => () => {
      snapshotGeneration.current += 1;
      if (trailingRefresh.current !== null) clearTimeout(trailingRefresh.current);
    },
    []
  );

  useEffect(() => {
    if (online) return;
    snapshotGeneration.current += 1;
    replayGapRef.current = false;
    lastSalesRefresh.current = 0;
    if (trailingRefresh.current !== null) {
      clearTimeout(trailingRefresh.current);
      trailingRefresh.current = null;
    }
    // Remove authenticated operational data, not merely hide it. Re-enabling
    // the query after reconnect must perform a network read instead of
    // treating a recently cached pre-outage snapshot as current.
    void utils.companion.snapshot.reset({ date: today });
  }, [online, today, utils]);

  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type === 'realtime.replay_gap') {
        snapshotGeneration.current += 1;
        replayGapRef.current = true;
        setReplayGap(true);
        void invalidateNow();
        return;
      }
      if (event.type !== 'companion.invalidated' || !isCompanionInvalidation(event.data)) return;
      if (event.data.scope === 'day_close') {
        void invalidateNow();
      } else {
        scheduleSalesRefresh();
      }
    },
    [invalidateNow, scheduleSalesRefresh]
  );

  useRealtimeChannel({
    collection: 'companion',
    onEvent,
    onStateChange: setConnection,
    enabled: online,
  });

  const liveState: LiveState = !online
    ? 'offline'
    : replayGap && connection === 'open'
      ? 'stale'
      : connection;

  return (
    <div className="space-y-5" data-testid="companion-home">
      <header className="space-y-1">
        <p className="pv-kicker">{t('kicker')}</p>
        <h1 className="pv-title text-xl">{t('title')}</h1>
        <p
          className={`flex items-center gap-1.5 text-sm ${
            liveState === 'open' ? 'text-success-700' : 'text-secondary-500'
          }`}
          data-testid="companion-connection"
          role="status"
        >
          {liveState === 'open' ? (
            <Radio className="h-4 w-4" aria-hidden="true" />
          ) : (
            <WifiOff className="h-4 w-4" aria-hidden="true" />
          )}
          {t(`connection.${liveState}`)}
        </p>
      </header>

      {!online ? (
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
      ) : snapshotQuery.isPending ? (
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
