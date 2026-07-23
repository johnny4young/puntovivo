/**
 * Offline V12 sync queue list.
 *
 * Right-side panel inside `OfflineModePanel` that surfaces every
 * row sitting in `sync_outbox` waiting to upload to the hub.
 * Each row carries: ticket-id tile, entity-type label, elapsed
 * time since `createdAt`, and a status badge driven by
 * `attempts` + `lastError`.
 *
 * Data source: `trpc.sync.listQueue` (). The query is
 * tenant-scoped via `tenantProcedure` server-side; the renderer
 * does NOT pass any tenantId.
 *
 * Reuses:
 * - `useOfflineSync` for the retry CTA action — when the user
 * taps "Reintentar" we re-fire the same `triggerSync()` the
 * banner exposes.
 * - `formatRelativeElapsed` (below) for the localized
 * "Hace N min" / "N min ago" copy via i18next plurals.
 *
 * Accessibility:
 * - Empty / loading / error states each carry distinct visuals
 * (no blank gray boxes).
 * - Retry CTA is a real `<button>` with `min-h-[44px]` per the
 * standing tap-target rule.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, RefreshCw, Inbox, AlertTriangle, Clock } from 'lucide-react';
import { Badge, type BadgeVariant } from '@/components/ui';
import { useOfflineSync } from '@/hooks';
import { trpc } from '@/lib/trpc';

/**
 * Renderer-side queue row shape. Intentionally drops `tenantId`
 * because the panel never displays it — exposing it on the
 * typed model would invite a future developer to render or log
 * the tenant id, which we want to keep server-side.
 */
interface QueueRow {
  id: string;
  entityType: string;
  entityId: string;
  operation: string;
  attempts: number;
  lastError: string | Record<string, unknown> | null;
  createdAt: string;
}

type DerivedStatus = 'pending' | 'retrying' | 'failed';

/**
 * Derive the badge tone from the row's attempts. Live device
 * retries cap at 's MAX_RETRIES (3); once exceeded the
 * server flips the row to `failed` / `dead_letter`. Gate purely
 * on `attempts` so a dead-letter row whose `lastError` was
 * administratively cleared still surfaces as failed (not as a
 * misleading "Retrying" spinner).
 */
function deriveStatus(row: QueueRow): DerivedStatus {
  if (row.attempts >= 3) return 'failed';
  if (row.attempts > 0) return 'retrying';
  return 'pending';
}

const STATUS_TONE: Record<DerivedStatus, BadgeVariant> = {
  pending: 'secondary',
  retrying: 'warning',
  failed: 'danger',
};

const STATUS_ICON: Record<DerivedStatus, typeof Clock> = {
  pending: Clock,
  retrying: RefreshCw,
  failed: AlertTriangle,
};

const ENTITY_TYPE_LABEL_KEY: Record<string, 'sale' | 'sale_item' | 'inventory_movement' | 'other'> =
  {
    sale: 'sale',
    sales: 'sale',
    sale_item: 'sale_item',
    sale_items: 'sale_item',
    inventory_movement: 'inventory_movement',
    inventory_movements: 'inventory_movement',
  };

/**
 * Render-time elapsed-time helper. Computes the gap in seconds,
 * picks the right plural bucket (justNow / seconds / minutes /
 * hours / days), and returns the i18next key + count payload.
 */
function elapsedKey(createdAt: string, now: Date): { key: string; count: number } {
  const created = new Date(createdAt).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(created)) return { key: 'offlineGrid.syncQueue.elapsed.justNow', count: 0 };
  const seconds = Math.max(0, Math.round((nowMs - created) / 1000));
  if (seconds < 5) return { key: 'offlineGrid.syncQueue.elapsed.justNow', count: 0 };
  if (seconds < 60) return { key: 'offlineGrid.syncQueue.elapsed.seconds', count: seconds };
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return { key: 'offlineGrid.syncQueue.elapsed.minutes', count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { key: 'offlineGrid.syncQueue.elapsed.hours', count: hours };
  const days = Math.round(hours / 24);
  return { key: 'offlineGrid.syncQueue.elapsed.days', count: days };
}

function truncateId(value: string): string {
  if (!value) return '—';
  if (value.length <= 8) return value;
  return value.slice(-8);
}

function getEntityLabelKey(entityType: string) {
  return ENTITY_TYPE_LABEL_KEY[entityType] ?? 'other';
}

interface OfflineSyncQueueListProps {
  /**
   * Override the "now" reference so tests can pin elapsed-time
   * output without freezing real time.
   */
  now?: Date;
}

export function OfflineSyncQueueList({ now }: OfflineSyncQueueListProps = {}) {
  const { t } = useTranslation('common');
  const { triggerSync, isSyncing } = useOfflineSync();
  const queueQuery = trpc.sync.listQueue.useQuery(
    { limit: 50 },
    {
      staleTime: 10_000,
      // The hub can be unreachable while offline; let React Query
      // fail fast and re-enable when the query is refetched after
      // reconnect (the banner already drives the refetch on the
      // online event via `useOfflineSync` cache invalidation).
      retry: 1,
    }
  );

  // Stable per-render reference so unrelated re-renders (e.g.
  // `isSyncing` flipping while the operator taps Reintentar) do
  // not silently re-roll every row's elapsed-time label.
  const referenceNow = useMemo(() => now ?? new Date(), [now]);

  if (queueQuery.isLoading) {
    return (
      <section
        data-testid="offline-sync-queue-loading"
        className="card flex h-full flex-col gap-3 p-4"
      >
        <header>
          <p className="page-kicker">{t('offlineGrid.syncQueue.title')}</p>
        </header>
        <div className="flex items-center gap-2 text-sm text-secondary-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('offlineGrid.syncQueue.loading')}
        </div>
      </section>
    );
  }

  if (queueQuery.error) {
    return (
      <section
        role="alert"
        data-testid="offline-sync-queue-error"
        className="card flex h-full flex-col gap-3 border-danger-300 bg-danger-50 p-4"
      >
        <header className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-danger-600" aria-hidden="true" />
          <p className="text-sm font-semibold text-danger-700">
            {t('offlineGrid.syncQueue.errorTitle')}
          </p>
        </header>
        <p className="text-xs text-danger-600">{t('offlineGrid.syncQueue.errorDescription')}</p>
        <button
          type="button"
          data-testid="offline-sync-queue-error-retry"
          onClick={() => {
            void queueQuery.refetch();
          }}
          className="btn-outline inline-flex min-h-[44px] items-center justify-center gap-2 self-start"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t('offlineGrid.syncQueue.retry')}
        </button>
      </section>
    );
  }

  const rows = (queueQuery.data?.items ?? []) as QueueRow[];

  if (rows.length === 0) {
    return (
      <section
        data-testid="offline-sync-queue-empty"
        className="card flex h-full flex-col gap-3 p-4"
      >
        <header>
          <p className="page-kicker">{t('offlineGrid.syncQueue.title')}</p>
          <p className="mt-1 text-xs text-secondary-600">{t('offlineGrid.syncQueue.subtitle')}</p>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-success-200 bg-success-50/40 p-4 text-center">
          <CheckCircle2 className="h-6 w-6 text-success-600" aria-hidden="true" />
          <p className="text-sm font-medium text-success-700">{t('offlineGrid.syncQueue.empty')}</p>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="offline-sync-queue" className="card flex h-full flex-col gap-3 p-4">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="page-kicker">{t('offlineGrid.syncQueue.title')}</p>
          <p className="mt-1 text-xs text-secondary-600">{t('offlineGrid.syncQueue.subtitle')}</p>
        </div>
        <button
          type="button"
          data-testid="offline-sync-queue-retry"
          onClick={() => {
            void triggerSync();
          }}
          disabled={isSyncing}
          className="btn-outline inline-flex min-h-[44px] items-center justify-center gap-2 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {t('offlineGrid.syncQueue.retry')}
        </button>
      </header>
      <ul className="flex flex-col gap-2 overflow-y-auto">
        {rows.map(row => {
          const status = deriveStatus(row);
          const StatusIcon = STATUS_ICON[status];
          const elapsed = elapsedKey(row.createdAt, referenceNow);
          const entityKey = getEntityLabelKey(row.entityType);
          return (
            <li
              key={row.id}
              data-testid={`offline-sync-queue-row-${row.id}`}
              data-status={status}
              className="flex items-start justify-between gap-3 rounded-2xl border border-line/70 bg-surface/95 p-3"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="glyph-tile glyph-tile-primary h-9 w-9">
                  <Inbox className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-secondary-950">
                    {t('offlineGrid.syncQueue.ticketLabel', { id: truncateId(row.entityId) })}
                  </p>
                  <p className="text-[0.62rem] uppercase tracking-[0.18em] text-secondary-500">
                    {t(`offlineGrid.syncQueue.entityType.${entityKey}`)}
                    {' · '}
                    {elapsed.count === 0 && elapsed.key.endsWith('justNow')
                      ? t(elapsed.key)
                      : t(elapsed.key, { count: elapsed.count })}
                  </p>
                </div>
              </div>
              <Badge variant={STATUS_TONE[status]}>
                <StatusIcon
                  className={`h-3 w-3 ${status === 'retrying' ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {t(`offlineGrid.syncQueue.status.${status}`)}
              </Badge>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
