/** Live kitchen board: coherent server projection, explicit stale/offline states and CAS actions. */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useRealtimeChannel } from '@/hooks/useRealtimeChannel';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { KdsEmptyState } from './KdsEmptyState';
import { KdsStationColumn } from './KdsStationColumn';
import { KdsConfiguration } from './KdsConfiguration';
import { useKitchenOnline } from './useKitchenOnline';
import type { KdsCardData, KitchenInputs } from './types';

export function KdsBoard() {
  const { currentSite, currentTenant } = useTenant();
  const { user } = useAuth();
  const { t } = useTranslation('kds');
  if (!currentSite)
    return (
      <p data-testid="kds-no-site" className="p-8 text-secondary-200">
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
  const { t } = useTranslation('kds');
  const toast = useToast();
  const utils = trpc.useUtils();
  const online = useKitchenOnline();
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [station, setStation] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const list = trpc.kds.list.useQuery(
    { siteId, ...(station ? { station } : {}), limit: 500 },
    { refetchInterval: 30_000 }
  );
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
  for (const order of list.data?.items ?? [])
    groups.set(order.station, [...(groups.get(order.station) ?? []), order]);
  const configuredStations = [...(stations.data ?? [])];
  const stationPositions = new Map(configuredStations.map(item => [item.code, item.position]));
  if (!stationPositions.has('main')) stationPositions.set('main', 0);
  const compareStations = (a: string, b: string) =>
    (stationPositions.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (stationPositions.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b);
  const availableStations = new Map(
    configuredStations.map(item => [
      item.code,
      item.name === 'main' ? t('station.main') : item.name,
    ])
  );
  if (!availableStations.has('main')) availableStations.set('main', t('station.main'));
  for (const [code, orders] of groups)
    if (!availableStations.has(code)) availableStations.set(code, orders[0]?.stationName ?? code);
  if (station && !availableStations.has(station)) availableStations.set(station, station);
  return (
    <div className="flex flex-col gap-6" data-testid="kds-board">
      <h1 className="text-xl font-semibold text-secondary-100">
        {t('boardTitle', { site: siteName })}
      </h1>
      <div className="flex flex-wrap items-end justify-between gap-4 text-secondary-100">
        <label className="flex flex-col gap-1">
          {t('config.stationFilter')}
          <select
            className="rounded-lg border bg-secondary-900 p-2"
            value={station}
            onChange={event => setStation(event.target.value)}
            disabled={busy}
          >
            <option value="">{t('config.allStations')}</option>
            {[...availableStations]
              .sort(([a], [b]) => compareStations(a, b))
              .map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
          </select>
        </label>
        <div className="flex gap-3">
          <button
            type="button"
            className="min-h-11 rounded-lg border px-3"
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
              className="min-h-11 rounded-lg border px-3"
              onClick={() => setConfigurationOpen(true)}
              disabled={busy}
            >
              {t('config.title')}
            </button>
          )}
        </div>
      </div>
      {!online && (
        <p role="status" className="rounded-lg bg-amber-100 p-4 text-amber-950">
          {t('errors.offline')}
        </p>
      )}
      {list.isError && (
        <p
          role="alert"
          data-testid="kds-load-error"
          className="rounded-lg bg-amber-100 p-4 text-amber-950"
        >
          {t('errors.loadFailed')}
        </p>
      )}
      {list.isLoading ? (
        <p role="status" className="text-secondary-200">
          {t('config.loading')}
        </p>
      ) : !list.isError && groups.size === 0 ? (
        <KdsEmptyState />
      ) : null}
      {list.data?.hasMore && (
        <p role="status" className="rounded-lg bg-amber-100 p-4 text-amber-950">
          {t('errors.hasMore')}
        </p>
      )}
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
      {canManage && configurationOpen && (
        <KdsConfiguration siteId={siteId} onClose={() => setConfigurationOpen(false)} />
      )}
    </div>
  );
}
