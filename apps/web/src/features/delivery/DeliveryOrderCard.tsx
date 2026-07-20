/**
 * Domicilios touch V5: single order card.
 *
 * Renders the master-list tile per the V5 spec: ID tile + customer
 * name + phone + address + items snapshot summary + total currency
 * + Detalle CTA. Active row highlights via `ring-2 ring-primary`.
 *
 * The `items_snapshot` column is a JSON string; we render a
 * collapsed line summary here and defer the full breakdown to the
 * detail panel.
 */
import { useTranslation } from 'react-i18next';
import { ChevronRight, Phone } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export interface DeliveryOrderRow {
  id: string;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  address: string;
  addressNotes?: string | null;
  courierName?: string | null;
  status: 'accepted' | 'preparing' | 'dispatched' | 'delivered' | 'cancelled';
  totalAmount: number;
  itemsSnapshot?: string | null;
  acceptedAt: string;
}

interface DeliveryOrderCardProps {
  order: DeliveryOrderRow;
  isSelected: boolean;
  onSelect: () => void;
}

function summarizeItems(snapshot: string | null | undefined): string | null {
  if (!snapshot) return null;
  try {
    const parsed: unknown = JSON.parse(snapshot);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const totalUnits = parsed.reduce<number>((sum, entry) => {
      if (typeof entry === 'object' && entry !== null && 'qty' in entry) {
        const qty = Number((entry as { qty: unknown }).qty);
        return Number.isFinite(qty) ? sum + qty : sum;
      }
      return sum;
    }, 0);
    if (totalUnits > 0) return `${totalUnits}`;
    return `${parsed.length}`;
  } catch {
    return null;
  }
}

export function DeliveryOrderCard({ order, isSelected, onSelect }: DeliveryOrderCardProps) {
  const { t } = useTranslation('delivery');
  const itemsSummary = summarizeItems(order.itemsSnapshot);

  return (
    <article
      data-testid={`delivery-card-${order.id}`}
      data-selected={isSelected ? 'true' : 'false'}
      className={[
        'rounded-xl border bg-surface-1 p-3 transition-colors',
        isSelected
          ? 'border-primary-500 ring-2 ring-primary-200'
          : 'border-line/70 hover:border-line',
      ].join(' ')}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-secondary-500">
            {t('card.idLabel')}
          </p>
          <p className="font-display text-lg tabular-nums">{order.id.slice(-8)}</p>
        </div>
        <button
          type="button"
          onClick={onSelect}
          aria-label={t('card.detailsCta')}
          data-testid={`delivery-card-${order.id}-cta`}
          className="inline-flex items-center gap-1 rounded-full border border-line/70 px-3 py-1 text-xs font-medium hover:bg-surface-2"
        >
          {t('card.detailsCta')}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </header>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex items-baseline gap-2">
          <dt className="sr-only">{t('card.idLabel')}</dt>
          <dd className="font-medium text-secondary-900">{order.customerName}</dd>
        </div>
        {order.customerPhone ? (
          <div className="flex items-center gap-1 text-xs text-secondary-600">
            <Phone className="h-3 w-3" aria-hidden="true" />
            <span>{order.customerPhone}</span>
          </div>
        ) : null}
        <div className="text-xs text-secondary-600">
          <span className="font-medium">{t('card.addressLabel')}: </span>
          {order.address}
        </div>
        {itemsSummary ? (
          <div className="text-xs text-secondary-600">
            <span className="font-medium">{t('card.itemsLabel')}: </span>
            {itemsSummary}
          </div>
        ) : null}
      </dl>
      <footer className="mt-2 flex items-center justify-between border-t border-line/50 pt-2">
        <span className="text-xs uppercase tracking-[0.18em] text-secondary-500">
          {t('card.totalLabel')}
        </span>
        <span
          className="font-display text-base tabular-nums"
          data-testid={`delivery-card-${order.id}-total`}
        >
          {formatCurrency(order.totalAmount)}
        </span>
      </footer>
    </article>
  );
}
