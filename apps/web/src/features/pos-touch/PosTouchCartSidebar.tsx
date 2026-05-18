/**
 * ENG-087 — Touch POS V1 cart sidebar.
 *
 * Right-side panel that mirrors `SalesCheckoutPanel` for the
 * touch surface: customer slot (with the loyalty badge + "Sumar
 * puntos" CTA placeholder), line items list, subtotal/tax/total
 * stack, and the Cobrar CTA.
 *
 * Loyalty profile:
 *  - V1 wires the badge + CTA but renders them ONLY when the
 *    selected customer carries an optional `loyaltyProfile`
 *    field. The schema does not have the field today; ENG-087b
 *    will land it. The slot is forward-compatible — once the
 *    server starts populating `loyaltyProfile`, the badge + CTA
 *    surface automatically.
 *
 * Touch-first design notes:
 *  - Every interactive element ≥ 44 × 44 px.
 *  - Line rows truncate the product name so no horizontal
 *    overflow at 320 px.
 *  - Cobrar CTA stays sticky at the bottom of the rail on tall
 *    viewports via `sticky bottom-0` so the cashier can always
 *    reach it.
 */
import { useTranslation } from 'react-i18next';
import { CreditCard, Sparkles, Trash2, X } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { SaleCartItem, SaleCartSummary } from '@/features/sales/saleCart';

/**
 * Forward-compatible loyalty profile shape. The customers schema
 * does not carry this today; ENG-087b will land it. ENG-087 V1
 * only reads `present || null` so the slot is invisible until the
 * server populates the field.
 */
export interface PosTouchLoyaltyProfile {
  tier?: string;
  points?: number;
}

export interface PosTouchCustomer {
  id: string;
  name: string;
  loyaltyProfile?: PosTouchLoyaltyProfile | null;
}

interface PosTouchCartSidebarProps {
  items: SaleCartItem[];
  summary: SaleCartSummary;
  customer: PosTouchCustomer | null;
  canCharge: boolean;
  chargeDisabledReason: 'noSite' | 'noSession' | 'noItems' | null;
  isCharging: boolean;
  onClearCart: () => void;
  onRemoveLine: (key: string) => void;
  onCharge: () => void;
}

export function PosTouchCartSidebar({
  items,
  summary,
  customer,
  canCharge,
  chargeDisabledReason,
  isCharging,
  onClearCart,
  onRemoveLine,
  onCharge,
}: PosTouchCartSidebarProps) {
  const { t } = useTranslation('posTouch');
  const showLoyaltyBadge = Boolean(customer?.loyaltyProfile);
  const lineCount = items.length;

  const chargeHint =
    chargeDisabledReason === 'noSession'
      ? t('cart.chargeDisabledNoSession')
      : chargeDisabledReason === 'noSite'
      ? t('cart.chargeDisabledNoSite')
      : chargeDisabledReason === 'noItems'
      ? t('cart.chargeDisabledNoItems')
      : null;

  return (
    <aside
      data-testid="pos-touch-cart"
      className="flex flex-col gap-3 rounded-xl border border-line/70 bg-surface-1 p-4"
    >
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.18em] text-secondary-500">
          {t('cart.title')}
        </p>
        <p className="text-sm font-medium text-secondary-700">
          {t('cart.lineCount', { count: lineCount })}
        </p>
      </header>

      <section
        data-testid="pos-touch-cart-customer"
        className="space-y-1 rounded-lg border border-line/50 bg-surface-2/40 p-3"
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-secondary-500">
          {t('cart.customer')}
        </p>
        <p className="text-sm font-medium text-secondary-900">
          {customer?.name ?? t('cart.customerPlaceholder')}
        </p>
        {showLoyaltyBadge ? (
          <div
            data-testid="pos-touch-cart-loyalty"
            className="mt-2 flex flex-col gap-1 rounded-md border border-warning-200 bg-warning-50/60 p-2"
          >
            <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.12em] text-warning-700">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              {t('cart.loyalty.badge')}
            </span>
            <button
              type="button"
              data-testid="pos-touch-cart-loyalty-cta"
              className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-md border border-warning-300 bg-surface-1 px-2 py-1 text-xs font-medium text-warning-700 hover:bg-warning-50"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {t('cart.loyalty.sumarPuntos')}
            </button>
            <p className="text-[11px] text-warning-600">
              {t('cart.loyalty.sumarPuntosHelp')}
            </p>
          </div>
        ) : null}
      </section>

      <section className="flex-1 space-y-1 overflow-y-auto">
        {items.length === 0 ? (
          <div
            data-testid="pos-touch-cart-empty"
            className="rounded-md border border-dashed border-line bg-surface-1 p-4 text-center text-xs text-secondary-500"
          >
            {t('cart.empty')}
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map(item => {
              const lineTotal = item.unitPrice * item.quantity;
              return (
                <li
                  key={item.key}
                  data-testid={`pos-touch-cart-line-${item.key}`}
                  className="flex items-start gap-2 rounded-md border border-line/40 bg-surface-1 p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-secondary-900">
                      {item.productName}
                    </p>
                    <p className="text-[11px] tabular-nums text-secondary-500">
                      {item.quantity} {item.unitName} · {formatCurrency(item.unitPrice)}
                    </p>
                  </div>
                  <span className="font-display text-sm tabular-nums text-secondary-900">
                    {formatCurrency(lineTotal)}
                  </span>
                  <button
                    type="button"
                    data-testid={`pos-touch-cart-line-${item.key}-remove`}
                    aria-label={t('cart.lineRemoveAriaLabel', { name: item.productName })}
                    onClick={() => onRemoveLine(item.key)}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line/70 text-secondary-500 hover:border-danger-300 hover:bg-danger-50 hover:text-danger-700"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-1 border-t border-line/40 pt-2 text-sm">
        <div className="flex items-center justify-between text-xs text-secondary-600">
          <span>{t('cart.subtotal')}</span>
          <span className="tabular-nums">{formatCurrency(summary.subtotal)}</span>
        </div>
        {summary.taxAmount > 0 ? (
          <div className="flex items-center justify-between text-xs text-secondary-600">
            <span>{t('cart.tax')}</span>
            <span className="tabular-nums">{formatCurrency(summary.taxAmount)}</span>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between border-t border-line/30 pt-1">
          <span className="text-xs uppercase tracking-[0.18em] text-secondary-500">
            {t('cart.total')}
          </span>
          <span
            data-testid="pos-touch-cart-total"
            className="font-display text-2xl tabular-nums text-secondary-900"
          >
            {formatCurrency(summary.total)}
          </span>
        </div>
      </section>

      <footer className="sticky bottom-0 flex flex-col gap-2 bg-surface-1 pt-2">
        <button
          type="button"
          data-testid="pos-touch-cart-charge"
          onClick={onCharge}
          disabled={!canCharge || isCharging}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-base font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-secondary-300 disabled:text-secondary-600"
        >
          <CreditCard className="h-4 w-4" aria-hidden="true" />
          {t('cart.charge')}
        </button>
        {chargeHint ? (
          <p
            data-testid="pos-touch-cart-charge-hint"
            className="rounded-md border border-warning-300 bg-warning-50 px-2 py-1 text-[11px] text-warning-700"
          >
            {chargeHint}
          </p>
        ) : null}
        {items.length > 0 ? (
          <button
            type="button"
            data-testid="pos-touch-cart-clear"
            onClick={onClearCart}
            className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-md border border-line/70 px-3 py-1 text-xs font-medium text-secondary-600 hover:border-danger-300 hover:bg-danger-50 hover:text-danger-700"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            {t('cart.clear')}
          </button>
        ) : null}
      </footer>
    </aside>
  );
}
