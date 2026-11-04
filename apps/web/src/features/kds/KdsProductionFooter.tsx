import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/lib/utils';
import type { KdsCardData } from './types';

/** Adds up what is still to make across the visible tickets, by product. */
function getProductionTotals(orders: readonly KdsCardData[]) {
  const totals = new Map<
    string,
    { key: string; name: string; quantity: number; unitLabel: string | null }
  >();
  for (const order of orders) {
    if (order.status !== 'pending' || order.integrity !== 'valid') continue;
    for (const item of order.items) {
      if (item.status === 'ready' || item.status === 'voided') continue;
      const key = `${item.productId}:${item.unitLabel}`;
      const total = totals.get(key);
      if (total) total.quantity += item.quantity;
      else
        totals.set(key, {
          key,
          name: item.productName,
          quantity: item.quantity,
          unitLabel: item.unitLabel,
        });
    }
  }
  return [...totals.values()].sort((a, b) => b.quantity - a.quantity);
}

export function KdsProductionFooter({ orders }: { orders: readonly KdsCardData[] }) {
  const { t } = useTranslation('kds');
  const totals = getProductionTotals(orders);
  if (totals.length === 0) return null;

  return (
    <footer
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line-strong bg-surface px-4 py-3 text-ink shadow-lg"
      aria-label={t('production.label')}
      data-testid="kds-production-footer"
    >
      <span className="text-sm font-semibold">{t('production.label')}</span>
      {totals.map(total => (
        <span key={total.key} className="text-sm">
          <strong className="tabular-nums">
            {formatNumber(total.quantity)}
            {total.unitLabel ? ` ${total.unitLabel}` : ''}
          </strong>{' '}
          {total.name}
        </span>
      ))}
    </footer>
  );
}
