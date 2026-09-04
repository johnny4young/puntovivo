import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';
import { ExternalQuoteReview } from './ExternalQuoteReview';
import { externalButtonClass, externalInputClass, type ExternalOrderDetail } from './types';

export function ExternalOrderPanel({
  siteId,
  id,
  onChanged,
}: {
  siteId: string;
  id: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation(['externalOrders', 'common', 'errors', 'fulfillmentErrors']);
  const query = trpc.externalOrders.get.useQuery(
    { siteId, id },
    { staleTime: 0, refetchInterval: 5_000 }
  );
  if (query.isLoading) return <p role="status">{t('common:status.loading')}</p>;
  if (query.error || !query.data)
    return (
      <div role="alert">
        <p>{translateServerError(query.error, t, t('errors:server.unknown'))}</p>
        <button
          type="button"
          className={externalButtonClass}
          onClick={() => {
            void query.refetch();
          }}
        >
          {t('common:actions.retry')}
        </button>
      </div>
    );
  return (
    <ExternalOrderActions
      key={`${id}:${query.data.version}`}
      row={query.data}
      disabled={query.isFetching}
      onChanged={() => {
        void query.refetch();
        onChanged();
      }}
    />
  );
}
function ExternalOrderActions({
  row,
  disabled,
  onChanged,
}: {
  row: ExternalOrderDetail;
  disabled: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation(['externalOrders', 'common', 'errors']);
  const [accepting, setAccepting] = useState(false);
  const [reviewing, setReviewing] = useState(false),
    [reason, setReason] = useState(''),
    [error, setError] = useState<string | null>(null),
    busy = useRef(false);
  const quote = trpc.externalOrders.quote.useQuery(
    { siteId: row.siteId, id: row.id },
    { enabled: reviewing && row.status === 'received', staleTime: 0, retry: false }
  );
  const reject = useCriticalMutation('externalOrders.reject'),
    resolve = useCriticalMutation('externalOrders.resolveCancellation');
  const pending = accepting || reject.isPending || resolve.isPending;
  const canResolve =
    row.status === 'cancel_requested' &&
    (row.sale?.status === 'cancelled' || row.sale?.paymentStatus === 'refunded');
  async function close() {
    if (busy.current || pending || disabled || !reason.trim()) return;
    busy.current = true;
    setError(null);
    const input = {
      siteId: row.siteId,
      id: row.id,
      expectedVersion: row.version,
      reason: reason.trim(),
    };
    try {
      if (row.status === 'received') await reject.mutateAsync(input);
      else if (canResolve) await resolve.mutateAsync(input);
      else return;
      onChanged();
    } catch (failure) {
      setError(translateServerError(failure, t, t('errors:server.unknown')));
      onChanged();
    } finally {
      busy.current = false;
    }
  }
  const source = row.snapshot;
  return (
    <article
      className="space-y-4 rounded border border-line bg-surface-1 p-4"
      data-testid="external-order-detail"
    >
      <header>
        <h3 className="break-words font-display text-2xl">{row.externalId}</h3>
        <p className="font-semibold">{t(`status.${row.status}`)}</p>
      </header>
      {source ? (
        <div className="space-y-2">
          <p className="font-semibold">{source.customerName}</p>
          {source.phone && <p>{source.phone}</p>}
          <p className="whitespace-pre-wrap break-words">{source.address}</p>
          {source.notes && <p className="whitespace-pre-wrap break-words">{source.notes}</p>}
          <p>
            {t('quote.sourceTotal')}: {formatCurrency(source.quotedTotal, source.currencyCode)}
          </p>
          <ul>
            {source.items.map((item, index) => (
              <li key={index} className="break-words">
                {item.productCode} × {item.quantity}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>{t('detail.tombstone')}</p>
      )}
      {row.reason && (
        <p className="whitespace-pre-wrap break-words">
          {t('detail.reason')}: {row.reason}
        </p>
      )}
      {row.sale && (
        <div className="space-y-2 rounded border border-line p-3">
          <p>{t('detail.sale', { number: row.sale.saleNumber })}</p>
          <Link
            className="inline-block underline"
            to="/sales"
            state={{ externalOrderSale: { id: row.sale.id, draft: row.sale.status === 'draft' } }}
          >
            {t(row.sale.status === 'draft' ? 'detail.openDraft' : 'detail.openSale')}
          </Link>
          {row.sale.status === 'draft' && (
            <p className="text-sm text-secondary-700">
              {t('detail.findDraft', { reference: row.externalId })}
            </p>
          )}
          {row.status === 'accepted' &&
            row.sale.status === 'completed' &&
            !['refunded', 'partially_refunded'].includes(row.sale.paymentStatus) && (
              <Link
                className="block underline"
                to={`/delivery?sale=${encodeURIComponent(row.sale.id)}`}
              >
                {t('detail.createDelivery')}
              </Link>
            )}
        </div>
      )}
      {row.status === 'cancel_requested' && (
        <p
          role="status"
          className="rounded border border-warning-300 bg-warning-50 p-3 text-warning-900"
        >
          {t('detail.cancelRequested')}
        </p>
      )}
      {row.status === 'received' && (
        <div className="space-y-3">
          <button
            type="button"
            className={externalButtonClass}
            disabled={disabled || pending || quote.isFetching}
            onClick={() => {
              setReviewing(true);
              if (reviewing) void quote.refetch();
            }}
          >
            {t('quote.review')}
          </button>
          {quote.isFetching && <p role="status">{t('common:status.loading')}</p>}
          {reviewing && quote.error && (
            <p role="alert" className="text-danger-700">
              {translateServerError(quote.error, t, t('errors:server.unknown'))}
            </p>
          )}
          {reviewing && quote.data && (
            <ExternalQuoteReview
              key={quote.data.fingerprint}
              siteId={row.siteId}
              quote={quote.data}
              disabled={disabled || pending || quote.isFetching || !!quote.error}
              onPendingChange={setAccepting}
              onAccepted={onChanged}
              onRefresh={() => {
                void quote.refetch();
                onChanged();
              }}
            />
          )}
        </div>
      )}
      {(row.status === 'received' || row.status === 'cancel_requested') && (
        <div className="space-y-3">
          <label className="block">
            {t('detail.reason')}
            <textarea
              className={externalInputClass}
              value={reason}
              onChange={event => setReason(event.target.value)}
              maxLength={500}
              disabled={pending}
            />
          </label>
          <button
            type="button"
            className={externalButtonClass}
            disabled={
              pending ||
              disabled ||
              !reason.trim() ||
              (row.status === 'cancel_requested' && !canResolve)
            }
            onClick={() => {
              void close();
            }}
          >
            {t(row.status === 'received' ? 'detail.reject' : 'detail.resolveCancellation')}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger-700">
          {error}
        </p>
      )}
      <details>
        <summary className="cursor-pointer">{t('detail.history')}</summary>
        <ol className="mt-2 space-y-2">
          {row.events.map(event => (
            <li key={event.id}>
              {t('detail.event', {
                version: event.version,
                state: t(`status.${event.toStatus}`),
                source: t(`detail.source.${event.source}`),
              })}
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}
