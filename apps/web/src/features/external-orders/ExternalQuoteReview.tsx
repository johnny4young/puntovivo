import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';
import type { ExternalQuote } from './types';
/** Remounted by fingerprint: changed catalog prices always invalidate the prior checkbox consent. */
export function ExternalQuoteReview({
  siteId,
  quote,
  disabled,
  onAccepted,
  onRefresh,
  onPendingChange,
}: {
  siteId: string;
  quote: ExternalQuote;
  disabled: boolean;
  onAccepted: () => void;
  onRefresh: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { t } = useTranslation(['externalOrders', 'errors', 'fulfillmentErrors']);
  const [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState<string | null>(null),
    busy = useRef(false);
  const accept = useCriticalMutation('externalOrders.accept');
  async function submit() {
    if (!confirmed || disabled || busy.current) return;
    busy.current = true;
    onPendingChange(true);
    setError(null);
    try {
      await accept.mutateAsync({
        siteId,
        id: quote.id,
        expectedVersion: quote.expectedVersion,
        fingerprint: quote.fingerprint,
        confirmedLocalPricing: true,
      });
      onAccepted();
    } catch (failure) {
      setError(translateServerError(failure, t, t('errors:server.unknown')));
      setConfirmed(false);
      onRefresh();
    } finally {
      busy.current = false;
      onPendingChange(false);
    }
  }
  return (
    <section
      className="space-y-3 rounded border border-primary-300 bg-primary-50 p-4"
      aria-label={t('quote.title')}
    >
      <h4 className="font-semibold">{t('quote.title')}</h4>
      <ul className="space-y-2">
        {quote.items.map((item, index) => (
          <li key={`${item.productId}:${index}`} className="flex flex-wrap justify-between gap-2">
            <span>
              {item.name} × {item.quantity}
            </span>
            <span>{formatCurrency(item.unitPrice, quote.currencyCode)}</span>
          </li>
        ))}
      </ul>
      <dl className="space-y-1">
        <div className="flex justify-between gap-2">
          <dt>{t('quote.localTotal')}</dt>
          <dd className="font-semibold">{formatCurrency(quote.total, quote.currencyCode)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t('quote.sourceTotal')}</dt>
          <dd>{formatCurrency(quote.quotedTotal, quote.currencyCode)}</dd>
        </div>
      </dl>
      {quote.amountDiffers && <p className="font-medium text-warning-900">{t('quote.differs')}</p>}
      <p className="text-sm text-secondary-700">{t('quote.draftOnly')}</p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={confirmed}
          disabled={accept.isPending || disabled}
          onChange={event => setConfirmed(event.target.checked)}
        />
        <span>{t('quote.confirm')}</span>
      </label>
      {error && (
        <p role="alert" className="text-danger-700">
          {error}
        </p>
      )}
      <button
        type="button"
        className="rounded bg-primary-700 px-3 py-2 text-white disabled:opacity-50"
        disabled={!confirmed || disabled || accept.isPending}
        onClick={() => {
          void submit();
        }}
      >
        {t('quote.accept')}
      </button>
    </section>
  );
}
