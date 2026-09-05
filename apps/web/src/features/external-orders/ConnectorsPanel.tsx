import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Overlay } from '@/components/overlay/Overlay';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { ConnectorForm } from './ConnectorForm';
import { externalButtonClass, type ExternalConnector } from './types';

export function ConnectorsPanel({ siteId }: { siteId: string }) {
  const { t } = useTranslation(['externalOrders', 'common', 'errors', 'fulfillmentErrors']);
  const query = trpc.externalOrders.connectors.useQuery({ siteId });
  const [editing, setEditing] = useState<ExternalConnector | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null),
    busy = useRef(false);
  const update = useCriticalMutation('externalOrders.updateConnector', { gcTime: 0 });
  async function toggle(row: ExternalConnector) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await update.mutateAsync({
        siteId,
        id: row.id,
        expectedVersion: row.version,
        enabled: !row.enabled,
      });
      await query.refetch();
    } catch (failure) {
      setError(translateServerError(failure, t, t('errors:server.unknown')));
      void query.refetch();
    } finally {
      busy.current = false;
    }
  }
  return (
    <section className="space-y-4" aria-label={t('connectors.title')}>
      <h3 className="font-display text-2xl">{t('connectors.title')}</h3>
      <p className="max-w-3xl text-sm text-secondary-700">{t('connectors.sandboxOnly')}</p>
      <p className="text-sm text-secondary-700">
        {t('connectors.endpoint')} <code>/api/trpc/externalOrders.receive</code>
      </p>
      {query.isLoading && <p role="status">{t('common:status.loading')}</p>}
      {(query.error || error) && (
        <div role="alert">
          <p>{error ?? translateServerError(query.error, t, t('errors:server.unknown'))}</p>
          <button
            type="button"
            className={externalButtonClass}
            onClick={() => {
              setError(null);
              void query.refetch();
            }}
          >
            {t('common:actions.retry')}
          </button>
        </div>
      )}
      {query.data && !query.data.keyAvailable && (
        <p
          role="alert"
          className="rounded border border-warning-300 bg-warning-50 p-3 text-warning-900"
        >
          {t('connectors.keyUnavailable')}
        </p>
      )}
      <button
        type="button"
        className="rounded bg-primary-700 px-3 py-2 text-white disabled:opacity-50"
        disabled={
          !query.data?.keyAvailable ||
          !!query.error ||
          query.isFetching ||
          update.isPending ||
          (query.data?.rows.length ?? 0) >= 100
        }
        onClick={() => setEditing('new')}
      >
        {t('connectors.create')}
      </button>
      {query.data?.rows.length === 0 && <p>{t('connectors.empty')}</p>}
      <ul className="space-y-3">
        {query.data?.rows.map(row => (
          <li key={row.id} className="space-y-2 rounded border border-line bg-surface-1 p-4">
            <h4 className="font-semibold">{row.name}</h4>
            <p>{t(row.enabled ? 'connectors.enabled' : 'connectors.disabled')}</p>
            <label className="block text-sm">
              {t('connectors.id')}
              <input
                className="mt-1 w-full rounded border border-line bg-surface-2 p-2 font-mono"
                readOnly
                value={row.id}
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={externalButtonClass}
                disabled={update.isPending || !!query.error}
                onClick={() => {
                  void toggle(row);
                }}
              >
                {t(row.enabled ? 'connectors.disable' : 'connectors.enable')}
              </button>
              <button
                type="button"
                className={externalButtonClass}
                disabled={!query.data?.keyAvailable || update.isPending || !!query.error}
                onClick={() => setEditing(row)}
              >
                {t('connectors.rotate')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {editing && (
        <Overlay
          isOpen
          title={t(editing === 'new' ? 'connectors.create' : 'connectors.rotate')}
          onClose={() => {}}
          closeOnEsc={false}
          closeOnBackdrop={false}
          showCloseButton={false}
          size="md"
        >
          <ConnectorForm
            siteId={siteId}
            connector={editing === 'new' ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void query.refetch();
            }}
          />
        </Overlay>
      )}
    </section>
  );
}
