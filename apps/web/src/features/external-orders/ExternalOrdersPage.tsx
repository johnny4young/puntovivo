import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { ExternalOrderPanel } from './ExternalOrderPanel';
import { ConnectorsPanel } from './ConnectorsPanel';
import { externalButtonClass, externalStatuses, type ExternalOrderDetail } from './types';

export function ExternalOrdersPage() {
  const { currentSite } = useTenant();
  return <ExternalSite key={currentSite?.id ?? ''} siteId={currentSite?.id ?? ''} />;
}
function ExternalSite({ siteId }: { siteId: string }) {
  const { t } = useTranslation(['externalOrders', 'common', 'errors', 'fulfillmentErrors']),
    { user } = useAuth();
  const [section, setSection] = useState<'orders' | 'connectors'>('orders'),
    [status, setStatus] = useState<ExternalOrderDetail['status']>('received'),
    [selected, setSelected] = useState<string | null>(null),
    [cursors, setCursors] = useState<Array<{ id: string; createdAt: string }>>([]);
  const utils = trpc.useUtils();
  const list = trpc.externalOrders.list.useQuery(
    { siteId, status, ...(cursors.at(-1) ? { cursor: cursors.at(-1)! } : {}) },
    { enabled: !!siteId && section === 'orders', staleTime: 0, refetchInterval: 5_000 }
  );
  function changed() {
    void utils.externalOrders.invalidate();
    void utils.sales.invalidate();
    void utils.deliveryOrders.invalidate();
  }
  if (!siteId) return <p>{t('noSite')}</p>;
  return (
    <section className="space-y-4" data-testid="external-orders-page">
      <header>
        <h2 className="font-display text-3xl">{t('title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-secondary-700">{t('subtitle')}</p>
      </header>
      {user?.role === 'admin' && (
        <nav className="flex gap-3" aria-label={t('sections.label')}>
          <button
            type="button"
            className={externalButtonClass}
            aria-pressed={section === 'orders'}
            onClick={() => setSection('orders')}
          >
            {t('sections.orders')}
          </button>
          <button
            type="button"
            className={externalButtonClass}
            aria-pressed={section === 'connectors'}
            onClick={() => setSection('connectors')}
          >
            {t('sections.connectors')}
          </button>
        </nav>
      )}
      {section === 'connectors' && user?.role === 'admin' ? (
        <ConnectorsPanel siteId={siteId} />
      ) : (
        <>
          <label className="block text-sm">
            {t('state')}
            <select
              className="ml-2 rounded border border-line bg-surface-1 p-2"
              value={status}
              onChange={event => {
                setStatus(event.target.value as ExternalOrderDetail['status']);
                setCursors([]);
                setSelected(null);
              }}
            >
              {externalStatuses.map(value => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </select>
          </label>
          {list.isLoading && <p role="status">{t('common:status.loading')}</p>}
          {list.error && (
            <div role="alert">
              <p>{translateServerError(list.error, t, t('errors:server.unknown'))}</p>
              <button
                type="button"
                className={externalButtonClass}
                onClick={() => {
                  void list.refetch();
                }}
              >
                {t('common:actions.retry')}
              </button>
            </div>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              {!list.error && list.data?.rows.length === 0 && (
                <p className="rounded border border-dashed border-line p-6">{t('empty')}</p>
              )}
              {list.data?.rows.map(row => (
                <button
                  type="button"
                  key={row.id}
                  className="block w-full space-y-1 rounded border border-line bg-surface-1 p-4 text-left hover:bg-surface-2"
                  aria-pressed={selected === row.id}
                  onClick={() => setSelected(row.id)}
                >
                  <span className="block break-words font-semibold">{row.externalId}</span>
                  <span className="block">
                    {row.snapshot?.customerName ?? t('detail.tombstone')}
                  </span>
                  <span className="block text-sm text-secondary-700">
                    {t(`status.${row.status}`)}
                  </span>
                </button>
              ))}
              <nav className="flex gap-3" aria-label={t('pagination.label')}>
                <button
                  type="button"
                  className={externalButtonClass}
                  disabled={!cursors.length || list.isFetching}
                  onClick={() => {
                    setCursors(previous => previous.slice(0, -1));
                    setSelected(null);
                  }}
                >
                  {t('pagination.previous')}
                </button>
                <button
                  type="button"
                  className={externalButtonClass}
                  disabled={!list.data?.hasMore || list.isFetching || !!list.error}
                  onClick={() => {
                    const last = list.data?.rows.at(-1);
                    if (last) {
                      setCursors(previous => [
                        ...previous,
                        { id: last.id, createdAt: last.createdAt },
                      ]);
                      setSelected(null);
                    }
                  }}
                >
                  {t('pagination.next')}
                </button>
              </nav>
            </div>
            {selected ? (
              <ExternalOrderPanel
                key={selected}
                siteId={siteId}
                id={selected}
                onChanged={changed}
              />
            ) : (
              <p className="rounded border border-dashed border-line p-6 text-secondary-700">
                {t('select')}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
