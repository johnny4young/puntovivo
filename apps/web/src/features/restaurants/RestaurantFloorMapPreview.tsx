import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { TFunction } from 'i18next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { cn, formatCurrency, formatDate } from '@/lib/utils';

type FloorSummary = inferRouterOutputs<AppRouter>['restaurantTables']['listSummary'];
export type FloorTable = FloorSummary['items'][number];
type FloorState = FloorTable['state'];

const STATE_STYLE: Record<FloorState, { tile: string; detail: string; swatch: string }> = {
  free: {
    tile: 'border-line bg-surface text-secondary-950 hover:border-primary-300',
    detail: 'text-secondary-600',
    swatch: '',
  },
  occupied: {
    tile: 'border-transparent bg-rail text-rail-foreground',
    detail: 'text-[var(--rail-muted)]',
    swatch: 'bg-rail',
  },
  billRequested: {
    tile: 'border-transparent bg-warning-500 text-rail',
    detail: 'text-rail',
    swatch: 'bg-warning-500',
  },
  reserved: {
    tile: 'border-dashed border-primary-400 bg-primary-50 text-secondary-950',
    detail: 'text-secondary-700',
    swatch: 'border border-dashed border-primary-400 bg-primary-50',
  },
};
const LEGEND_STATES = ['occupied', 'billRequested', 'reserved'] as const;
const tableNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** «18 min» under an hour, «1 h 05» after, measured against the server snapshot. */
function formatElapsed(t: TFunction, openedAt: string, generatedAt: string): string {
  const minutes =
    Math.max(0, Math.floor((Date.parse(generatedAt) - Date.parse(openedAt)) / 60_000)) || 0;
  if (minutes < 60) return t('floorMap.elapsedMinutes', { count: minutes });
  return t('floorMap.elapsedHours', {
    hours: Math.floor(minutes / 60),
    minutes: String(minutes % 60).padStart(2, '0'),
  });
}

function tileLines(t: TFunction, table: FloorTable, generatedAt: string): [string, string] {
  const amount = formatCurrency(table.total);
  switch (table.state) {
    case 'free':
      return [
        t('floorMap.status.free'),
        table.seatCount !== null
          ? t('floorMap.party', { count: table.seatCount })
          : t('floorMap.seatCountUnknown'),
      ];
    case 'reserved':
      return [
        t('floorMap.status.reserved'),
        table.nextReservation
          ? formatDate(table.nextReservation.startsAt, { dateStyle: undefined, timeStyle: 'short' })
          : '',
      ];
    case 'billRequested':
      return [
        t('floorMap.status.billRequested'),
        [amount, table.pendingRound ? t('floorMap.roundReady') : null].filter(Boolean).join(' · '),
      ];
    case 'occupied': {
      const elapsed = table.openedAt ? formatElapsed(t, table.openedAt, generatedAt) : '';
      const head =
        table.guestCount !== null
          ? [t('floorMap.party', { count: table.guestCount }), elapsed].filter(Boolean).join(' · ')
          : elapsed;
      const detail = [
        table.openChecks > 1 ? t('floorMap.checks', { count: table.openChecks }) : null,
        amount,
        table.pendingRound ? t('floorMap.roundReady') : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return [head, detail];
    }
  }
}

interface RestaurantFloorMapPreviewProps {
  summary: FloorSummary;
  selectedTableId?: string | null;
  /** Open deliveries at the site; null hides the Domicilios tab. */
  deliveryCount?: number | null;
  onSelect?: (table: FloorTable) => void;
}

function channelLabel(t: TFunction, key: 'takeaway' | 'delivery', count: number): string {
  return count > 0 ? t(`floorMap.channels.${key}Count`, { count }) : t(`floorMap.channels.${key}`);
}

function TakeawayList({ summary }: { summary: FloorSummary }) {
  const { t } = useTranslation('restaurants');
  const { items, totalItems } = summary.takeaway;
  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-fg2" data-testid="restaurant-takeaway-empty">
        {t('floorMap.takeaway.empty')}
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y divide-line" data-testid="restaurant-takeaway-list">
        {items.map(order => (
          <li
            key={order.id}
            className="flex items-center gap-4 py-3"
            data-testid={`restaurant-takeaway-${order.id}`}
          >
            <span className="min-w-0 flex-1 truncate font-semibold text-fg1">
              {order.label ?? t('floorMap.takeaway.untitled', { number: order.saleNumber })}
            </span>
            <span className="text-sm text-fg2">
              {formatElapsed(t, order.suspendedAt, summary.generatedAt)}
            </span>
            <span className="w-28 text-right font-semibold tabular-nums text-fg1">
              {formatCurrency(order.total)}
            </span>
          </li>
        ))}
      </ul>
      {totalItems > items.length && (
        <p className="mt-3 text-xs text-fg2">
          {t('floorMap.takeaway.partial', { shown: items.length, total: totalItems })}
        </p>
      )}
    </>
  );
}

/** The main view of the tables page: tables by area with their live state. */
export function RestaurantFloorMapPreview({
  summary,
  selectedTableId = null,
  deliveryCount = null,
  onSelect,
}: RestaurantFloorMapPreviewProps) {
  const { t } = useTranslation('restaurants');
  const [channel, setChannel] = useState<'floor' | 'takeaway'>('floor');
  const grouped = useMemo(() => {
    const map = new Map<string, FloorTable[]>();
    for (const table of summary.items) {
      const key = table.area ?? t('floorMap.noAreaLabel');
      const list = map.get(key);
      if (list) list.push(table);
      else map.set(key, [table]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => tableNameCollator.compare(a.name, b.name));
    }
    return [...map.entries()];
  }, [summary.items, t]);
  const channelTabs = (
    <nav
      aria-label={t('floorMap.channels.label')}
      className="mb-5 flex flex-wrap gap-2"
      data-testid="restaurant-floor-channels"
    >
      <button
        type="button"
        className="modifier-option shrink-0 rounded-full"
        aria-pressed={channel === 'floor'}
        onClick={() => setChannel('floor')}
        data-testid="restaurant-floor-channel-floor"
      >
        {t('floorMap.channels.floor')}
      </button>
      <button
        type="button"
        className="modifier-option shrink-0 rounded-full"
        aria-pressed={channel === 'takeaway'}
        onClick={() => setChannel('takeaway')}
        data-testid="restaurant-floor-channel-takeaway"
      >
        {channelLabel(t, 'takeaway', summary.takeaway.totalItems)}
      </button>
      {deliveryCount !== null && (
        <Link
          to="/delivery"
          className="modifier-option shrink-0 rounded-full"
          data-testid="restaurant-floor-channel-delivery"
        >
          {channelLabel(t, 'delivery', deliveryCount)}
        </Link>
      )}
    </nav>
  );
  let body: ReactNode;
  if (channel === 'takeaway') {
    body = <TakeawayList summary={summary} />;
  } else if (summary.items.length === 0) {
    body = (
      <p
        className="py-6 text-center text-sm text-secondary-600"
        data-testid="restaurant-floor-map-empty"
      >
        {t('tables.empty')}
      </p>
    );
  } else {
    body = (
      <>
        <div className="space-y-5">
          {grouped.map(([area, tables]) => (
            <div key={area}>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-secondary-600">
                {t('floorMap.areaCount', { area, count: tables.length })}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {tables.map(table => {
                  const [head, detail] = tileLines(t, table, summary.generatedAt);
                  const selected = table.id === selectedTableId;
                  return (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() => onSelect?.(table)}
                      aria-current={selected ? 'true' : undefined}
                      data-testid={`restaurant-floor-table-${table.id}`}
                      data-state={table.state}
                      className={cn(
                        'flex min-h-28 flex-col items-center justify-center rounded-2xl border-2 px-3 py-3 text-center transition-colors',
                        STATE_STYLE[table.state].tile,
                        selected && 'ring-4 ring-brand-accent-500 ring-offset-4 ring-offset-card'
                      )}
                    >
                      <span className="text-lg font-bold leading-tight tracking-[-0.01em]">
                        {table.name}
                      </span>
                      <span
                        className="mt-1 text-xs font-semibold"
                        data-testid={`restaurant-floor-status-${table.state}`}
                      >
                        {head}
                      </span>
                      {detail && (
                        <span className={cn('mt-0.5 text-xs', STATE_STYLE[table.state].detail)}>
                          {detail}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-secondary-700">
          <ul className="flex flex-wrap items-center gap-4" aria-label={t('floorMap.legendLabel')}>
            {LEGEND_STATES.map(state => (
              <li key={state} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-3 w-3 rounded-[4px] ring-1 ring-line-strong',
                    STATE_STYLE[state].swatch
                  )}
                />
                {t(`floorMap.legend.${state}`)}
              </li>
            ))}
          </ul>
          <span data-testid="restaurant-floor-occupancy">
            {t('floorMap.occupancy', {
              occupied: summary.occupiedTables,
              total: summary.totalItems,
            })}
          </span>
        </footer>
      </>
    );
  }
  return (
    <section data-testid="restaurant-floor-map-preview" className="card mb-6 p-5 sm:p-6">
      {channelTabs}
      {body}
    </section>
  );
}
