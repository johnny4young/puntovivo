/**
 * Kitchen Display Screen board.
 *
 * Owns the `kds.list` query, the realtime channel subscription, and
 * the mark-ready / recall mutations. The board re-fetches the list
 * whenever a `kds.order.*` event arrives on the SSE channel, so the
 * kitchen TV reflects waiter-side changes (suspend / changeTable /
 * splitDraft / discardDraft / void) in real time.
 *
 * Layout: one CSS-grid column per station. v1 ships a single "main"
 * station so all cards pool into one column.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, RotateCw } from 'lucide-react';
import { useToast } from '@/components/feedback/ToastProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useRealtimeChannel } from '@/hooks/useRealtimeChannel';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { KdsEmptyState } from './KdsEmptyState';
import { KdsStationColumn } from './KdsStationColumn';
import type { KdsCardData } from './KdsOrderCard';

const REFRESH_INTERVAL_MS = 30_000;

export function KdsBoard() {
  const { t } = useTranslation('kds');
  const toast = useToast();
  const { currentSite } = useTenant();
  const siteId = currentSite?.id ?? null;

  const utils = trpc.useUtils();
  const listQuery = trpc.kds.list.useQuery(siteId ? { siteId } : {}, {
    enabled: siteId !== null,
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  const markReadyMutation = trpc.kds.markReady.useMutation({
    onSuccess: async () => {
      await utils.kds.list.invalidate();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'toast.markReadyError',
    }),
    onSettled: () => {
      setBusyOrderId(null);
    },
  });

  const recallMutation = trpc.kds.recall.useMutation({
    onSuccess: async () => {
      await utils.kds.list.invalidate();
      toast.info({ title: t('toast.recalled') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'toast.recallError',
    }),
    onSettled: () => {
      setBusyOrderId(null);
    },
  });

  const handleReady = useCallback(
    (orderId: string) => {
      setBusyOrderId(orderId);
      markReadyMutation.mutate({ id: orderId });
    },
    [markReadyMutation]
  );

  const handleRecall = useCallback(
    (orderId: string) => {
      setBusyOrderId(orderId);
      recallMutation.mutate({ id: orderId });
    },
    [recallMutation]
  );

  useRealtimeChannel({
    collection: 'kds',
    enabled: siteId !== null,
    onEvent: () => {
      void utils.kds.list.invalidate();
    },
  });

  const groupedByStation = useMemo(() => {
    const orders: KdsCardData[] = listQuery.data?.items ?? [];
    const map = new Map<string, KdsCardData[]>();
    for (const order of orders) {
      const arr = map.get(order.station) ?? [];
      arr.push(order);
      map.set(order.station, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [listQuery.data]);

  if (!siteId) {
    return (
      <div
        className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-secondary-200"
        data-testid="kds-no-site"
      >
        <AlertCircle className="h-10 w-10 opacity-70" aria-hidden="true" />
        <p className="text-lg">{t('errors.noSiteSelected')}</p>
      </div>
    );
  }

  if (listQuery.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-secondary-200">
        <RotateCw className="h-6 w-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (listQuery.isError) {
    return (
      <div
        className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-secondary-200"
        data-testid="kds-load-error"
      >
        <AlertCircle className="h-10 w-10 opacity-70" aria-hidden="true" />
        <p className="text-lg">{t('errors.loadFailed')}</p>
      </div>
    );
  }

  const totalOrders = listQuery.data?.items.length ?? 0;
  if (totalOrders === 0) {
    return <KdsEmptyState />;
  }

  return (
    <div className="flex flex-col gap-6" data-testid="kds-board">
      {groupedByStation.map(([stationKey, orders]) => (
        <KdsStationColumn
          key={stationKey}
          stationKey={stationKey}
          orders={orders}
          onReady={handleReady}
          onRecall={handleRecall}
          busyOrderId={busyOrderId}
        />
      ))}
    </div>
  );
}
