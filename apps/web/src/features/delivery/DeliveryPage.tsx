/**
 * ENG-091 — Domicilios touch V5.
 *
 * Operational queue for delivery / domicilio orders. Surfaces the
 * five status columns (Por aceptar · Preparando · En camino ·
 * Entregados · Con problema) on the left rail, the filtered card
 * list in the main column, and a persistent detail panel on the
 * right with the customer header, address block, items snapshot,
 * 5-step timeline, courier assignment, and advance / cancel
 * actions.
 *
 * The server scaffold (`deliveryOrders.list / create / advance`)
 * shipped at `0c75ca1`. This module owns the renderer-only side:
 * route gate via `delivery` module, V5 layout, and i18n
 * (`delivery` namespace) in neutral LATAM `tú`.
 *
 * Counts are derived from 5 parallel `list` queries (one per
 * status, each bounded by the existing `(tenant, site, status)`
 * index). A future `deliveryOrders.statusCounts` endpoint could
 * collapse this into a single roundtrip — tracked as ENG-091b.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck } from 'lucide-react';
import { useTenant } from '@/features/tenant/TenantProvider';
import { trpc } from '@/lib/trpc';
import { DeliveryOrderCard } from './DeliveryOrderCard';
import { DeliveryOrderDetail } from './DeliveryOrderDetail';

export type DeliveryStatus =
  | 'accepted'
  | 'preparing'
  | 'dispatched'
  | 'delivered'
  | 'cancelled';

const STATUS_COLUMNS: DeliveryStatus[] = [
  'accepted',
  'preparing',
  'dispatched',
  'delivered',
  'cancelled',
];

export function DeliveryPage() {
  const { t } = useTranslation('delivery');
  const { currentSite } = useTenant();
  const siteId = currentSite?.id ?? '';
  const [activeStatus, setActiveStatus] = useState<DeliveryStatus>('accepted');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // ENG-091 — one query per status column. The (tenant, site,
  // status) index keeps each query cheap; the per-column count
  // surfaces in the left rail badges. We bump `limit` to 200 so
  // the count is honest up to a busy day's queue (default router
  // limit is 50). Long-term: a dedicated statusCounts endpoint.
  const acceptedQuery = trpc.deliveryOrders.list.useQuery(
    { siteId, status: 'accepted', limit: 200 },
    { enabled: siteId.length > 0, staleTime: 30_000 }
  );
  const preparingQuery = trpc.deliveryOrders.list.useQuery(
    { siteId, status: 'preparing', limit: 200 },
    { enabled: siteId.length > 0, staleTime: 30_000 }
  );
  const dispatchedQuery = trpc.deliveryOrders.list.useQuery(
    { siteId, status: 'dispatched', limit: 200 },
    { enabled: siteId.length > 0, staleTime: 30_000 }
  );
  const deliveredQuery = trpc.deliveryOrders.list.useQuery(
    { siteId, status: 'delivered', limit: 200 },
    { enabled: siteId.length > 0, staleTime: 30_000 }
  );
  const cancelledQuery = trpc.deliveryOrders.list.useQuery(
    { siteId, status: 'cancelled', limit: 200 },
    { enabled: siteId.length > 0, staleTime: 30_000 }
  );

  const queriesByStatus = useMemo<Record<DeliveryStatus, ReturnType<typeof trpc.deliveryOrders.list.useQuery>>>(
    () => ({
      accepted: acceptedQuery,
      preparing: preparingQuery,
      dispatched: dispatchedQuery,
      delivered: deliveredQuery,
      cancelled: cancelledQuery,
    }),
    [acceptedQuery, preparingQuery, dispatchedQuery, deliveredQuery, cancelledQuery]
  );

  const activeQuery = queriesByStatus[activeStatus];
  const activeRows = useMemo(
    () => (Array.isArray(activeQuery.data) ? activeQuery.data : []),
    [activeQuery.data]
  );
  const selectedRow = useMemo(
    () => activeRows.find(row => row.id === selectedOrderId) ?? null,
    [activeRows, selectedOrderId]
  );

  if (!siteId) {
    return (
      <section className="space-y-3" data-testid="delivery-page">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-[0.18em] text-secondary-500">
            {t('page.kicker')}
          </p>
          <h2 className="font-display text-3xl">{t('page.title')}</h2>
        </header>
        <div className="rounded-xl border border-warning-300 bg-warning-50 p-4 text-warning-700">
          {t('page.noActiveSite')}
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full flex-col gap-4" data-testid="delivery-page">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.18em] text-secondary-500">
          {t('page.kicker')}
        </p>
        <h2 className="font-display text-3xl">{t('page.title')}</h2>
        <p className="max-w-3xl text-sm text-secondary-600">{t('page.subtitle')}</p>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[18rem,minmax(0,1fr),22rem]">
        {/* Status nav column */}
        <nav
          aria-label={t('page.title')}
          className="flex flex-col gap-2"
          data-testid="delivery-status-nav"
        >
          {STATUS_COLUMNS.map(status => {
            const query = queriesByStatus[status];
            const count = Array.isArray(query.data) ? query.data.length : 0;
            const isActive = status === activeStatus;
            return (
              <button
                key={status}
                type="button"
                data-testid={`delivery-status-${status}`}
                data-active={isActive ? 'true' : 'false'}
                onClick={() => {
                  setActiveStatus(status);
                  setSelectedOrderId(null);
                }}
                className={[
                  'flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                  isActive
                    ? 'border-primary-500 bg-primary-50 text-primary-900 ring-2 ring-primary-200'
                    : 'border-line/70 bg-surface-1 hover:bg-surface-2',
                ].join(' ')}
              >
                <span className="flex items-center gap-2">
                  <Truck className="h-4 w-4" aria-hidden="true" />
                  <span className="text-sm font-medium">
                    {t(`status.${status}.label`)}
                  </span>
                </span>
                <span
                  className="rounded-full bg-secondary-100 px-2 py-0.5 text-xs font-medium text-secondary-700 tabular-nums"
                  data-testid={`delivery-status-${status}-count`}
                >
                  {t(`status.${status}.count`, { count })}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Filtered cards list */}
        <div className="flex flex-col gap-2 overflow-y-auto" data-testid="delivery-cards">
          {activeQuery.isLoading ? (
            <div
              className="rounded-xl border border-line/70 bg-surface-1 p-4 text-sm text-secondary-500"
              data-testid="delivery-cards-loading"
            >
              {t('page.loading')}
            </div>
          ) : activeQuery.error ? (
            <div
              role="alert"
              className="rounded-xl border border-danger-300 bg-danger-50 p-4 text-sm text-danger-700"
              data-testid="delivery-cards-error"
            >
              <p className="font-medium">{t('page.errorTitle')}</p>
              <p className="mt-1 text-xs text-danger-600">
                {activeQuery.error.message}
              </p>
              <button
                type="button"
                onClick={() => activeQuery.refetch()}
                className="mt-2 rounded-md border border-danger-300 px-2 py-1 text-xs font-medium hover:bg-danger-100"
              >
                {t('page.errorRetry')}
              </button>
            </div>
          ) : activeRows.length === 0 ? (
            <div
              className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-sm text-secondary-500"
              data-testid="delivery-cards-empty"
            >
              {t('page.empty')}
            </div>
          ) : (
            activeRows.map(row => (
              <DeliveryOrderCard
                key={row.id}
                order={row}
                isSelected={row.id === selectedOrderId}
                onSelect={() => setSelectedOrderId(row.id)}
              />
            ))
          )}
        </div>

        {/* Right-side persistent detail */}
        <aside data-testid="delivery-detail" className="lg:sticky lg:top-4 lg:self-start">
          {selectedRow ? (
            <DeliveryOrderDetail
              // Reset internal state (courierName, confirmingCancel)
              // when the operator switches between orders in the
              // same column. Without this, typed courier names leak
              // across selections.
              key={selectedRow.id}
              order={selectedRow}
              onAdvanced={nextStatus => {
                // After an advance, jump the user to the new status
                // column so they keep working off the new lane.
                setActiveStatus(nextStatus);
                setSelectedOrderId(null);
              }}
              onCancelled={() => {
                setActiveStatus('cancelled');
                setSelectedOrderId(null);
              }}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-sm text-secondary-500">
              {t('detail.empty')}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
