/**
 * ENG-098 — single kitchen ticket card.
 *
 * Two visual states:
 *   - `pending`: full-opacity white card on the dark backdrop, big
 *     "LISTO" primary button.
 *   - `ready`: 40% opacity, struck-through table label, "Listo · HH:MM"
 *     stamp, "Volver a pendiente" ghost link for the recall recovery
 *     affordance.
 *
 * Elapsed time updates locally every 30 seconds without hammering the
 * board query. After 10 minutes the elapsed-time label switches to
 * amber to give the cook a visual nudge without an audible alarm.
 *
 * Pure presentational component — the parent owns the mutations + the
 * query invalidation; it just renders state and signals intent through
 * the two callbacks.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface KdsCardItem {
  saleItemId: string;
  productName: string;
  quantity: number;
}

export interface KdsCardData {
  id: string;
  saleId: string;
  saleNumber: string;
  tableLabel: string | null;
  station: string;
  items: KdsCardItem[];
  notes: string | null;
  status: 'pending' | 'ready';
  createdAt: string;
  readyAt: string | null;
}

export interface KdsOrderCardProps {
  order: KdsCardData;
  onReady: (orderId: string) => void;
  onRecall: (orderId: string) => void;
  /** Reduces the card to a read-only render — used while a mutation is in flight. */
  busy?: boolean;
}

const STALE_THRESHOLD_MS = 10 * 60_000;

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatQuantity(quantity: number): string {
  if (Number.isInteger(quantity)) {
    return String(quantity);
  }
  return quantity.toFixed(2).replace(/\.?0+$/, '');
}

export function KdsOrderCard({ order, onReady, onRecall, busy = false }: KdsOrderCardProps) {
  const { t } = useTranslation('kds');
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const interval = setInterval(updateNow, 30_000);
    return () => clearInterval(interval);
  }, []);

  const elapsedMs = useMemo(() => {
    const created = new Date(order.createdAt).getTime();
    if (Number.isNaN(created)) return 0;
    return Math.max(0, (now ?? created) - created);
  }, [now, order.createdAt]);

  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  const isStale = elapsedMs >= STALE_THRESHOLD_MS;
  const isReady = order.status === 'ready';

  const cardClass = [
    'flex flex-col gap-4 rounded-2xl border border-secondary-700 bg-secondary-50 p-5 text-secondary-950 shadow-lg shadow-secondary-950/40 transition-opacity duration-200',
    isReady ? 'opacity-40' : '',
  ]
    .join(' ')
    .trim();

  const elapsedClass = isStale
    ? 'text-base font-medium text-amber-700'
    : 'text-sm text-secondary-700';

  const tableLabelClass = [
    'text-2xl font-semibold',
    isReady ? 'line-through' : '',
  ]
    .join(' ')
    .trim();

  return (
    <article className={cardClass} data-testid="kds-order-card" data-order-status={order.status}>
      <header className="flex items-baseline justify-between gap-3">
        <span className={tableLabelClass} data-testid="kds-order-table-label">
          {order.tableLabel ?? t('card.untabledLabel')}
        </span>
        <span className="text-sm font-mono text-secondary-700">{order.saleNumber}</span>
      </header>

      <hr className="border-secondary-200" />

      <ul className="flex flex-col gap-2" aria-label={t('card.itemsAria')}>
        {order.items.length === 0 ? (
          <li className="text-sm italic text-secondary-700">{t('card.noItems')}</li>
        ) : (
          order.items.map(item => (
            <li key={item.saleItemId} className="flex items-baseline gap-3 text-lg">
              <span className="min-w-[1.5rem] font-bold tabular-nums">
                {formatQuantity(item.quantity)}
              </span>
              <span>{item.productName}</span>
            </li>
          ))
        )}
      </ul>

      {order.notes ? (
        <p className="rounded-lg bg-secondary-100 px-3 py-2 text-sm text-secondary-800">
          <span className="font-semibold">{t('card.noteLabel')}: </span>
          {order.notes}
        </p>
      ) : null}

      <footer className="flex flex-col gap-3">
        {isReady ? (
          <>
            <span className="text-sm text-secondary-800">
              {t('card.readyStamp', { time: formatTime(order.readyAt ?? order.createdAt) })}
            </span>
            <button
              type="button"
              className="self-start text-sm text-secondary-700 underline disabled:opacity-50"
              onClick={() => onRecall(order.id)}
              disabled={busy}
              data-testid="kds-order-recall"
            >
              {t('card.recall')}
            </button>
          </>
        ) : (
          <>
            <span className={elapsedClass} data-testid="kds-order-elapsed">
              {elapsedMinutes <= 0
                ? t('card.elapsedJustNow')
                : t('card.elapsedMinutes', { count: elapsedMinutes })}
            </span>
            <button
              type="button"
              className="w-full rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold uppercase tracking-wide text-secondary-50 transition-colors hover:bg-brand-500 disabled:opacity-50"
              onClick={() => onReady(order.id)}
              disabled={busy}
              data-testid="kds-order-ready"
            >
              {t('card.markReady')}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}
