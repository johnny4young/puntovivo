/** Live kitchen board: coherent server projection, explicit stale/offline states and CAS actions. */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useRealtimeChannel } from '@/hooks/useRealtimeChannel';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { resolveStationLabel } from './stationLabel';
import { KdsEmptyState } from './KdsEmptyState';
import { KdsStationColumn } from './KdsStationColumn';
import { KdsConfiguration } from './KdsConfiguration';
import { useKitchenOnline } from './useKitchenOnline';
import { KdsProductionFooter } from './KdsProductionFooter';
import type { KdsCardData, KitchenInputs } from './types';

export function KdsBoard() {
  const { currentSite, currentTenant } = useTenant();
  const { user } = useAuth();
  const { t } = useTranslation('kds');
  if (!currentSite)
    return (
      <p data-testid="kds-no-site" className="p-8 text-muted-foreground">
        {t('errors.noSiteSelected')}
      </p>
    );
  // Local drafts and pending controls cannot survive a tenant, login or site switch.
  return (
    <KitchenBoard
      key={`${currentTenant?.id}:${user?.id}:${currentSite.id}`}
      siteId={currentSite.id}
      siteName={currentSite.name}
      canManage={user?.role === 'admin' || user?.role === 'manager'}
    />
  );
}
function KitchenBoard({
  siteId,
  siteName,
  canManage,
}: {
  siteId: string;
  siteName: string;
  canManage: boolean;
}) {
  const { t } = useTranslation(['kds', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const online = useKitchenOnline();
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [station, setStation] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const list = trpc.kds.list.useQuery({ siteId, limit: 500 }, { refetchInterval: 30_000 });
  // Order SSE events do not cover configuration edits on another display.
  // Keep station ordering/filter choices fresh even without new submissions.
  const stations = trpc.kds.stations.useQuery({ siteId }, { refetchInterval: 30_000 });
  const options = {
    onError: onErrorToast(toast, t, { titleKey: 'toast.actionError' }),
    onSettled: async () => {
      await utils.kds.list.invalidate();
      lock.current = false;
      setBusy(false);
    },
  };
  const ready = trpc.kds.markReady.useMutation(options);
  const recall = trpc.kds.recall.useMutation(options);
  const resend = trpc.kds.resend.useMutation(options);
  const line = trpc.kds.transitionLine.useMutation(options);
  const act = <T,>(mutate: (input: T) => void, input: T) => {
    if (!online || list.isError || lock.current) return;
    lock.current = true;
    setBusy(true);
    mutate(input);
  };
  useRealtimeChannel({
    collection: 'kds',
    enabled: true,
    onEvent: () => {
      void utils.kds.list.invalidate();
    },
  });
  const groups = new Map<string, KdsCardData[]>();
  const stationCounts = new Map<string, number>();
  const allOrders = list.data?.items ?? [];
  // Chips count every station, so the filter applies here and not in the query.
  for (const order of allOrders) {
    stationCounts.set(order.station, (stationCounts.get(order.station) ?? 0) + 1);
    if (!station || order.station === station)
      groups.set(order.station, [...(groups.get(order.station) ?? []), order]);
  }
  const configuredStations = [...(stations.data ?? [])];
  const stationPositions = new Map(configuredStations.map(item => [item.code, item.position]));
  if (!stationPositions.has('main')) stationPositions.set('main', 0);
  const compareStations = (a: string, b: string) =>
    (stationPositions.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (stationPositions.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b);
  const availableStations = new Map(
    configuredStations.map(item => [item.code, resolveStationLabel(item, t('station.main'))])
  );
  if (!availableStations.has('main')) availableStations.set('main', t('station.main'));
  for (const order of allOrders)
    if (!availableStations.has(order.station))
      availableStations.set(order.station, order.stationName ?? order.station);
  if (station && !availableStations.has(station)) availableStations.set(station, station);
  return (
    <div className="flex flex-col gap-6" data-testid="kds-board">
      <h1 className="text-xl font-semibold text-ink">{t('boardTitle', { site: siteName })}</h1>
      <div className="flex flex-wrap items-center justify-between gap-4 text-ink">
        <div
          role="group"
          aria-label={t('config.stationFilter')}
          className="flex min-w-0 flex-wrap gap-2"
        >
          {[
            ['', t('config.allStations'), allOrders.length] as const,
            ...[...availableStations]
              .sort(([a], [b]) => compareStations(a, b))
              .map(([code, name]) => [code, name, stationCounts.get(code) ?? 0] as const),
          ].map(([code, name, count]) => (
            <button
              key={code || 'all'}
              type="button"
              data-testid={`kds-station-chip-${code || 'all'}`}
              aria-pressed={station === code}
              disabled={busy}
              onClick={() => setStation(code)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium ${
                station === code
                  ? 'border-primary-500 bg-primary-50 text-primary-900'
                  : 'border-line-strong bg-surface text-ink hover:bg-surface-2'
              }`}
            >
              {name}
              <span className="tabular-nums text-muted-foreground">{count}</span>
            </button>
          ))}
        </div>
        <span
          data-testid="kds-connection-status"
          className={`inline-flex min-h-11 items-center gap-2 text-sm font-medium ${
            online ? 'text-success-700' : 'text-warning-700'
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${online ? 'bg-success-500' : 'bg-warning-500'}`}
          />
          {online ? t('common:status.online') : t('common:status.offline')}
        </span>
        <div className="flex gap-3">
          <button
            type="button"
            className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 text-ink"
            onClick={() => {
              void list.refetch();
              void stations.refetch();
            }}
            disabled={!online || busy}
          >
            {t('config.refresh')}
          </button>
          {canManage && (
            <button
              type="button"
              className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 text-ink"
              onClick={() => setConfigurationOpen(true)}
              disabled={busy}
            >
              {t('config.title')}
            </button>
          )}
        </div>
      </div>
      {!online && (
        <p role="status" className="rounded-lg bg-warning-50 p-4 text-warning-700">
          {t('errors.offline')}
        </p>
      )}
      {list.isError && (
        <p
          role="alert"
          data-testid="kds-load-error"
          className="rounded-lg bg-warning-50 p-4 text-warning-700"
        >
          {t('errors.loadFailed')}
        </p>
      )}
      {list.isLoading ? (
        <p role="status" className="text-muted-foreground">
          {t('config.loading')}
        </p>
      ) : !list.isError && groups.size === 0 ? (
        <KdsEmptyState />
      ) : null}
      {list.data?.hasMore && (
        <p role="status" className="rounded-lg bg-warning-50 p-4 text-warning-700">
          {t('errors.hasMore')}
        </p>
      )}
      <div
        data-testid="kds-station-columns"
        className="flex flex-col gap-6 lg:grid lg:auto-cols-[minmax(20rem,1fr)] lg:grid-flow-col lg:items-start lg:overflow-x-auto"
      >
        {[...groups]
          .sort(([a], [b]) => compareStations(a, b))
          .map(([code, orders]) => (
            <KdsStationColumn
              key={code}
              stationKey={code}
              orders={orders}
              disabled={busy || !online || list.isError}
              onReady={(input: KitchenInputs['markReady']) => act(ready.mutate, input)}
              onRecall={(input: KitchenInputs['recall']) => act(recall.mutate, input)}
              onResend={(input: KitchenInputs['resend']) => act(resend.mutate, input)}
              onLine={(input: KitchenInputs['transitionLine']) => act(line.mutate, input)}
            />
          ))}
      </div>
      {canManage && configurationOpen && (
        <KdsConfiguration siteId={siteId} onClose={() => setConfigurationOpen(false)} />
      )}
      <KdsProductionFooter orders={[...groups.values()].flat()} />
    </div>
  );
}
