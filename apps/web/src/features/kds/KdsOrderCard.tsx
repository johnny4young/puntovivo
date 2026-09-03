/** Immutable preparation plus current destinations and explicitly versioned cook actions. */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { KdsActions, KdsCardData } from './types';
export type { KdsCardData } from './types';
/** Busy/offline cards stay readable but cannot enqueue delayed preparation commands. */
export interface KdsOrderCardProps extends KdsActions {
  order: KdsCardData;
  busy?: boolean;
}
const actionClass =
  'min-h-11 rounded-lg border border-secondary-400 px-3 py-2 text-sm font-medium disabled:opacity-50';
export function KdsOrderCard({
  order,
  onReady,
  onRecall,
  onResend,
  onLine,
  busy = false,
}: KdsOrderCardProps) {
  const { t, i18n } = useTranslation(['kds', 'restaurants']);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, []);
  const created = Date.parse(order.createdAt);
  const minutes = Number.isFinite(created)
    ? Math.max(0, Math.floor(((now ?? created) - created) / 60_000))
    : 0;
  const quantity = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 });
  const observed = { id: order.id, expectedVersion: order.version };
  const valid = order.integrity === 'valid';
  const cancelled = order.status === 'cancelled';
  const ready = order.status === 'ready';
  return (
    <article
      className="flex flex-col gap-4 rounded-2xl border border-secondary-700 bg-secondary-50 p-5 text-secondary-950 shadow-lg"
      data-testid="kds-order-card"
      data-order-status={order.status}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-2xl font-semibold" data-testid="kds-order-table-label">
          {order.multipleDestinations
            ? t('card.multipleDestinations')
            : (order.tableLabel ?? t('card.untabledLabel'))}
        </span>
        <span className="font-mono text-sm">{order.saleNumber}</span>
      </header>
      {!valid ? (
        <p role="alert" className="rounded-lg border border-danger-600 p-3">
          {t('server.KDS_SNAPSHOT_INVALID')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('card.itemsAria')}>
          {order.items.map(item => (
            <li
              key={item.saleItemId}
              className="border-t border-secondary-200 pt-3"
              data-testid="kds-order-card-item"
            >
              <div className="flex gap-3 text-lg">
                <span className="font-bold tabular-nums">
                  {quantity.format(item.quantity)}
                  {item.unitLabel ? ` ${item.unitLabel}` : ''}
                </span>
                <span className={item.status === 'voided' ? 'line-through' : ''}>
                  {item.productName}
                </span>
              </div>
              <p className="text-sm font-semibold">{t(`line.${item.status}`)}</p>
              {item.roundLabel && (
                <p className="text-sm">{t('card.round', { value: item.roundLabel })}</p>
              )}
              {item.courseKey && (
                <p className="text-sm">
                  {t('card.course', {
                    value: ['starter', 'main', 'dessert', 'drink', 'other'].includes(item.courseKey)
                      ? t(`cart.courses.${item.courseKey}`, { ns: 'restaurants' })
                      : item.courseKey,
                  })}
                </p>
              )}
              {item.dinerLabel && (
                <p className="text-sm">{t('card.diner', { value: item.dinerLabel })}</p>
              )}
              {order.multipleDestinations || item.currentSaleId !== order.saleId ? (
                <p className="text-sm font-medium">
                  {t('card.destination', {
                    table: item.currentTableLabel ?? t('card.untabledLabel'),
                    check: item.currentSaleNumber ?? t('card.unknownCheck'),
                  })}
                </p>
              ) : null}
              {item.modifiers.map((modifier, index) => (
                <p key={index} className="text-sm">
                  {quantity.format(modifier.quantity)} × {modifier.name}
                </p>
              ))}
              {item.notes && (
                <p className="text-sm italic" data-testid="kds-order-card-item-note">
                  {item.notes}
                </p>
              )}
              {!cancelled && item.id && item.version && item.status !== 'voided' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.status === 'pending' && (
                    <button
                      type="button"
                      className={actionClass}
                      disabled={busy}
                      onClick={() =>
                        onLine({
                          orderId: order.id,
                          lineId: item.id!,
                          expectedVersion: item.version!,
                          status: 'preparing',
                        })
                      }
                    >
                      {t('line.start')}
                    </button>
                  )}
                  <button
                    type="button"
                    className={actionClass}
                    disabled={busy}
                    onClick={() =>
                      onLine({
                        orderId: order.id,
                        lineId: item.id!,
                        expectedVersion: item.version!,
                        status: item.status === 'ready' ? 'pending' : 'ready',
                      })
                    }
                  >
                    {t(item.status === 'ready' ? 'line.recall' : 'line.finish')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {valid && order.notes && (
        <p className="rounded-lg bg-secondary-100 p-3 text-sm">
          <strong>{t('card.noteLabel')}: </strong>
          {order.notes}
        </p>
      )}
      <footer className="flex flex-col gap-3">
        {cancelled ? (
          <strong>{t('card.cancelled')}</strong>
        ) : ready ? (
          <span>
            {t('card.readyStamp', {
              time: new Date(order.readyAt ?? order.createdAt).toLocaleTimeString(i18n.language, {
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </span>
        ) : (
          <span
            className={minutes >= 10 ? 'font-medium text-amber-800' : 'text-sm'}
            data-testid="kds-order-elapsed"
          >
            {minutes <= 0 ? t('card.elapsedJustNow') : t('card.elapsedMinutes', { count: minutes })}
          </span>
        )}
        {valid && !cancelled && (
          <>
            <button
              type="button"
              className="btn-primary min-h-12 rounded-xl px-4 py-3"
              onClick={() => (ready ? onRecall(observed) : onReady(observed))}
              disabled={busy}
              data-testid={ready ? 'kds-order-recall' : 'kds-order-ready'}
            >
              {t(ready ? 'card.recall' : 'card.markReady')}
            </button>
            <button
              type="button"
              className={actionClass}
              disabled={busy}
              onClick={() => onResend(observed)}
            >
              {t('card.resend')}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}
