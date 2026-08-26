import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Radio,
  ShoppingBag,
  WifiOff,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useRealtimeChannel, type RealtimeEvent } from '@/hooks/useRealtimeChannel';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { calendarDayAt, formatCurrency, formatDateTime } from '@/lib/utils';

/** How many ticker entries the phone keeps in view. */
const TICKER_LIMIT = 12;
const SUMMARY_REFRESH_INTERVAL_MS = 10_000;

interface TickerEntry {
  saleId: string;
  saleNumber: string;
  total: number;
  completedAt: string;
  /** True when the entry arrived over the live channel in this session. */
  live: boolean;
}

function isSaleRetractedPayload(value: unknown): value is { saleId: string } {
  return Boolean(value) && typeof (value as { saleId?: unknown }).saleId === 'string';
}

function isSaleCompletedPayload(value: unknown): value is {
  saleId: string;
  saleNumber: string;
  total: number;
  completedAt: string;
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.saleId === 'string' &&
    typeof candidate.saleNumber === 'string' &&
    typeof candidate.total === 'number' &&
    typeof candidate.completedAt === 'string'
  );
}

/**
 * Read-only owner companion.
 *
 * The screen an owner opens on a phone away from the counter: what the
 * day has sold, whether the day is ready to close, and what needs
 * attention. Every surface here is READ-ONLY by design — acknowledging
 * an alert or signing a day close stays on the desktop app, where the
 * operator has the full context those irreversible actions need.
 *
 * The ticker is genuinely live: it seeds from `sales.list` and then
 * appends `sales.completed` events from the tenant realtime channel,
 * so a sale rung at the counter appears without a refresh. When the
 * channel drops, the header says so instead of showing a stale list as
 * if it were current.
 */
export function CompanionHome() {
  const { t } = useTranslation('companion');
  const [liveEntries, setLiveEntries] = useState<TickerEntry[]>([]);
  const [connection, setConnection] = useState<'connecting' | 'open' | 'closed'>('connecting');
  // A replay gap means the channel DROPPED events we will never see.
  // The header must stop claiming the view is live until a refresh
  // re-seeds it, instead of silently showing an incomplete ticker.
  const [replayGap, setReplayGap] = useState(false);
  const [retracted, setRetracted] = useState<ReadonlySet<string>>(() => new Set());
  const utils = trpc.useUtils();
  const lastSummaryRefresh = useRef(0);
  const summaryRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replaySeedGeneration = useRef(0);
  // Mirrors replayGap synchronously so back-to-back SSE events do not
  // wait for a React render before bypassing the ordinary refresh throttle.
  const replayGapRef = useRef(false);

  // One query feeds both the pulse and the ticker seed: the dashboard
  // summary already carries today's totals AND the recent sales the
  // ticker backfills from.
  const summaryQuery = trpc.dashboard.summary.useQuery(undefined, { staleTime: 30_000 });
  const attentionQuery = trpc.operations.needsAttention.useQuery(undefined, {
    staleTime: 30_000,
  });

  // "Today" has to be the tenant's calendar day, not the phone's: an owner
  // checking in from another timezone would otherwise ask for a day the
  // shop has not reached, and read a missing signature as an unsigned one.
  const locale = useResolvedLocale();
  const today = useMemo(() => calendarDayAt(new Date(), locale.timezone), [locale.timezone]);
  // Metadata only: the card needs signed-or-not, who and when. The full
  // signoff carries the whole report snapshot, which is a payload a phone
  // on a weak connection has no use for.
  const signoffQuery = trpc.reports.dayClose.signoffMetadata.useQuery(
    { date: today },
    { staleTime: 60_000 }
  );

  const invalidateSummaryNow = useCallback(async (): Promise<boolean> => {
    if (summaryRefreshTimer.current !== null) {
      clearTimeout(summaryRefreshTimer.current);
      summaryRefreshTimer.current = null;
    }
    lastSummaryRefresh.current = Date.now();
    const generation = replaySeedGeneration.current;
    try {
      await utils.dashboard.summary.invalidate();
      // A later successful event refresh can recover a prior failed
      // replay-gap seed, but an older request must never clear a newer gap.
      if (replaySeedGeneration.current === generation) {
        replayGapRef.current = false;
        setReplayGap(false);
      }
      return true;
    } catch {
      return false;
    }
  }, [utils]);

  const refreshSummary = useCallback(() => {
    // The pulse above the ticker must not drift while the ticker
    // grows: without this the phone can show a mount-time revenue
    // figure under a Live header all afternoon. Throttled so a busy
    // counter does not refetch on every ring.
    const now = Date.now();
    const elapsed = now - lastSummaryRefresh.current;
    // A knowingly stale screen should recover on the very next event;
    // the ordinary traffic throttle must not delay that reseed.
    if (replayGapRef.current || elapsed >= SUMMARY_REFRESH_INTERVAL_MS) {
      void invalidateSummaryNow();
      return;
    }
    // Coalesce the burst, but never DROP its last event: without a
    // trailing invalidation the pulse can remain behind forever when
    // the final sale lands inside the throttle window.
    if (summaryRefreshTimer.current === null) {
      summaryRefreshTimer.current = setTimeout(() => {
        void invalidateSummaryNow();
      }, SUMMARY_REFRESH_INTERVAL_MS - elapsed);
    }
  }, [invalidateSummaryNow]);

  useEffect(
    () => () => {
      replaySeedGeneration.current += 1;
      if (summaryRefreshTimer.current !== null) {
        clearTimeout(summaryRefreshTimer.current);
      }
    },
    []
  );

  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type === 'realtime.replay_gap') {
        replaySeedGeneration.current += 1;
        replayGapRef.current = true;
        setReplayGap(true);
        // The seed is the source of truth after a gap. Clear all local
        // overlays so a missed retraction cannot keep a stale sale
        // above the freshly fetched server result.
        setLiveEntries([]);
        setRetracted(new Set());
        // Failure is absorbed intentionally: keep the explicit stale
        // state until this or a later event refresh succeeds.
        void invalidateSummaryNow();
        return;
      }
      if (event.type === 'sales.retracted' && isSaleRetractedPayload(event.data)) {
        // A voided or returned sale stops being a sale: drop it from
        // the ticker instead of leaving money on screen that the
        // register already gave back.
        const { saleId } = event.data;
        setLiveEntries(previous => previous.filter(entry => entry.saleId !== saleId));
        setRetracted(previous => (previous.has(saleId) ? previous : new Set(previous).add(saleId)));
        refreshSummary();
        return;
      }
      if (event.type !== 'sales.completed' || !isSaleCompletedPayload(event.data)) return;
      refreshSummary();
      const payload = event.data;
      setLiveEntries(previous => {
        // The replay cursor can redeliver an event after a reconnect;
        // dedupe by sale id so a reconnect never double-counts a sale.
        if (previous.some(entry => entry.saleId === payload.saleId)) return previous;
        return [
          {
            saleId: payload.saleId,
            saleNumber: payload.saleNumber,
            total: payload.total,
            completedAt: payload.completedAt,
            live: true,
          },
          ...previous,
        ].slice(0, TICKER_LIMIT);
      });
    },
    [invalidateSummaryNow, refreshSummary]
  );

  useRealtimeChannel({ collection: 'sales', onEvent, onStateChange: setConnection });

  const ticker = useMemo(() => {
    const seeded: TickerEntry[] = (summaryQuery.data?.recentSales ?? []).map(sale => ({
      saleId: sale.id,
      saleNumber: sale.saleNumber,
      total: sale.total,
      completedAt: sale.createdAt,
      live: false,
    }));
    const seen = new Set(liveEntries.map(entry => entry.saleId));
    return [...liveEntries, ...seeded.filter(entry => !seen.has(entry.saleId))]
      .filter(entry => !retracted.has(entry.saleId))
      .slice(0, TICKER_LIMIT);
  }, [liveEntries, retracted, summaryQuery.data]);

  // An open socket after a replay gap is NOT the same as a live view:
  // events were dropped, so the ticker is knowingly incomplete.
  const liveState = replayGap && connection === 'open' ? 'stale' : connection;
  const summary = summaryQuery.data;
  const attention = attentionQuery.data;
  const signoff = signoffQuery.data;

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

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-secondary-600">{t('today.title')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-secondary-500">{t('today.revenue')}</p>
            <p
              className="text-2xl font-semibold text-secondary-950"
              data-testid="companion-revenue"
            >
              {formatCurrency(summary?.stats.todayRevenue.value ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-secondary-500">{t('today.orders')}</p>
            <p className="text-2xl font-semibold text-secondary-950">
              {summary?.stats.todayOrders.value ?? 0}
            </p>
          </div>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-secondary-600">
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
          {t('dayClose.title')}
        </h2>
        {signoffQuery.isPending ? (
          <p className="text-sm text-secondary-500">{t('dayClose.loading')}</p>
        ) : signoff ? (
          <div data-testid="companion-day-close-signed">
            <p className="flex items-center gap-2 text-sm font-semibold text-success-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {t('dayClose.signed')}
            </p>
            <p className="text-xs text-secondary-500">
              {t('dayClose.signedBy', {
                name: signoff.signedBy.name,
                time: formatDateTime(signoff.signedAt),
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
        {attention && attention.totalCount > 0 ? (
          <ul className="space-y-2" data-testid="companion-attention-list">
            {attention.areas.map(area => (
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
        {ticker.length === 0 ? (
          <p className="text-sm text-secondary-500">{t('ticker.empty')}</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="companion-ticker">
            {ticker.map(entry => (
              <li key={entry.saleId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-secondary-900">{entry.saleNumber}</p>
                  <p className="text-xs text-secondary-500">
                    {new Date(entry.completedAt).toLocaleTimeString()}
                  </p>
                </div>
                <strong className="shrink-0 text-sm text-secondary-950">
                  {formatCurrency(entry.total)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
