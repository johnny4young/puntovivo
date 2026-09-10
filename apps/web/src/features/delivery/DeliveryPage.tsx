/** Site-scoped fulfillment queue with real counts and bounded cursor pages. */
import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Overlay } from '@/components/overlay/Overlay';
import { Truck } from 'lucide-react';
import { useTenant } from '@/features/tenant/TenantProvider';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { DeliveryOrderCard } from './DeliveryOrderCard';

// The queue is read frequently; load its creation workflow only on explicit intent.
const LazyDeliveryCreateForm = lazy(() =>
  import('./DeliveryCreateForm').then(module => ({ default: module.DeliveryCreateForm }))
);
const LazyDeliveryOrderDetail = lazy(() =>
  import('./DeliveryOrderDetail').then(module => ({ default: module.DeliveryOrderDetail }))
);

/** Canonical delivery states exposed by the logistics API. */
export type DeliveryStatus = 'accepted' | 'preparing' | 'dispatched' | 'delivered' | 'cancelled';

const STATUS_COLUMNS: DeliveryStatus[] = [
  'accepted',
  'preparing',
  'dispatched',
  'delivered',
  'cancelled',
];

export function DeliveryPage() {
  const { currentSite } = useTenant();
  return <DeliverySiteQueue key={currentSite?.id ?? ''} siteId={currentSite?.id ?? ''} />;
}

function DeliverySiteQueue({ siteId }: { siteId: string }) {
  const { t } = useTranslation(['delivery', 'errors', 'fulfillmentErrors']);
  const [params, setParams] = useSearchParams();
  const initialSaleId = params.get('sale') ?? undefined;
  const [creating, setCreating] = useState(!!initialSaleId);
  const utils = trpc.useUtils();
  function closeCreation() {
    setCreating(false);
    if (initialSaleId) setParams({}, { replace: true });
  }
  const [activeStatus, setActiveStatus] = useState<DeliveryStatus>('accepted');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [cursors, setCursors] = useState<Array<{ id: string; acceptedAt: string }>>([]);
  const activeQuery = trpc.deliveryOrders.list.useQuery(
    {
      siteId,
      status: activeStatus,
      limit: 50,
      ...(cursors.at(-1) ? { cursor: cursors.at(-1)! } : {}),
    },
    { enabled: !!siteId, staleTime: 3_000, refetchInterval: 10_000 }
  );
  const countsQuery = trpc.deliveryOrders.counts.useQuery(
    { siteId },
    { enabled: !!siteId, staleTime: 3_000, refetchInterval: 10_000 }
  );
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
        <p className="text-xs uppercase tracking-[0.18em] text-secondary-500">{t('page.kicker')}</p>
        <h2 className="font-display text-3xl">{t('page.title')}</h2>
        <p className="max-w-3xl text-sm text-secondary-600">{t('page.subtitle')}</p>
        <button
          type="button"
          className="rounded bg-primary-700 px-3 py-2 text-white"
          onClick={() => setCreating(true)}
        >
          {t('create.title')}
        </button>
      </header>

      {creating ? (
        <Overlay
          isOpen
          onClose={closeCreation}
          title={t('create.title')}
          closeOnBackdrop={false}
          closeOnEsc={false}
          showCloseButton={false}
        >
          <Suspense fallback={<p role="status">{t('page.loading')}</p>}>
            <LazyDeliveryCreateForm
              siteId={siteId}
              initialSaleId={initialSaleId}
              onCancel={closeCreation}
              onCreated={id => {
                closeCreation();
                setActiveStatus('accepted');
                setCursors([]);
                setSelectedOrderId(id);
                void Promise.all([
                  utils.deliveryOrders.list.invalidate(),
                  utils.deliveryOrders.counts.invalidate(),
                  utils.deliveryOrders.saleOptions.invalidate(),
                ]);
              }}
            />
          </Suspense>
        </Overlay>
      ) : null}
      <div className="grid flex-1 grid-cols-1 gap-4 items-start lg:grid-cols-[12rem_minmax(0,1fr)] xl:grid-cols-[12rem_minmax(14rem,1fr)_20rem]">
        {/* Status nav column */}
        <nav
          aria-label={t('page.title')}
          className="flex flex-col gap-2"
          data-testid="delivery-status-nav"
        >
          {STATUS_COLUMNS.map(status => {
            const count = countsQuery.data?.[status];
            const isActive = status === activeStatus;
            return (
              <button
                key={status}
                type="button"
                data-testid={`delivery-status-${status}`}
                data-active={isActive ? 'true' : 'false'}
                onClick={() => {
                  setActiveStatus(status);
                  setCursors([]);
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
                  <span className="text-sm font-medium">{t(`status.${status}.label`)}</span>
                </span>
                <span
                  className="rounded-full bg-secondary-100 px-2 py-0.5 text-xs font-medium text-secondary-700 tabular-nums"
                  data-testid={`delivery-status-${status}-count`}
                >
                  {count === undefined || countsQuery.error
                    ? '—'
                    : t(`status.${status}.count`, { count })}
                </span>
              </button>
            );
          })}
          {countsQuery.error ? <p role="alert">{t('page.countError')}</p> : null}
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
                {translateServerError(activeQuery.error, t, t('page.errorTitle'))}
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
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!cursors.length || activeQuery.isFetching}
              onClick={() => {
                setCursors(current => current.slice(0, -1));
                setSelectedOrderId(null);
              }}
              className="rounded border border-line px-3 py-2 disabled:opacity-50"
            >
              {t('page.previous')}
            </button>
            <button
              type="button"
              disabled={activeRows.length < 50 || activeQuery.isFetching || !!activeQuery.error}
              onClick={() => {
                const last = activeRows.at(-1);
                if (!last) return;
                setCursors(current => [...current, { id: last.id, acceptedAt: last.acceptedAt }]);
                setSelectedOrderId(null);
              }}
              className="rounded border border-line px-3 py-2 disabled:opacity-50"
            >
              {t('page.next')}
            </button>
          </div>
        </div>

        {/* Right-side persistent detail */}
        <aside
          data-testid="delivery-detail"
          className="lg:col-span-2 xl:col-span-1 xl:sticky xl:top-4 xl:self-start"
        >
          {selectedRow ? (
            <Suspense fallback={<p role="status">{t('page.loading')}</p>}>
              <LazyDeliveryOrderDetail
                // Reset internal state (courierName, confirmingCancel)
                // when the operator switches between orders in the
                // same column. Without this, typed courier names leak
                // across selections.
                key={`${selectedRow.id}:${selectedRow.version}`}
                order={selectedRow}
                onAdvanced={nextStatus => {
                  // After an advance, jump the user to the new status
                  // column so they keep working off the new lane.
                  setActiveStatus(nextStatus);
                  setCursors([]);
                  setSelectedOrderId(null);
                }}
                onCancelled={() => {
                  setActiveStatus('cancelled');
                  setCursors([]);
                  setSelectedOrderId(null);
                }}
              />
            </Suspense>
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
