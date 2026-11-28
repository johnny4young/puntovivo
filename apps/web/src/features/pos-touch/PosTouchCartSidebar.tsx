/**
 * Touch POS V1 cart sidebar.
 *
 * Right-side panel that mirrors `SalesCheckoutPanel` for the
 * touch surface: customer slot (with the loyalty badge + "Sumar
 * puntos" CTA placeholder), line items list, subtotal/tax/total
 * stack, and the Cobrar CTA.
 *
 * Loyalty profile:
 * - V1 wires the badge + CTA but renders them ONLY when the
 * selected customer carries an optional `loyaltyProfile`
 * field. The schema does not have the field today;
 * will land it. The slot is forward-compatible — once the
 * server starts populating `loyaltyProfile`, the badge + CTA
 * surface automatically.
 *
 * Touch-first design notes:
 * - Every interactive element ≥ 44 × 44 px.
 * - Line rows truncate the product name so no horizontal
 * overflow at 320 px.
 * - On large screens the rail and the catalog scroll separately inside a
 * viewport-height page, and `sticky bottom-0` keeps the Cobrar CTA visible
 * when the lines overflow the rail.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, Minus, Plus, Sparkles, Trash2, WalletCards, X } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { getLineTotals } from '@/features/sales/saleCartTotals';
import {
  canChangeCartItemUnit,
  getSaleMinimumQuantity,
  getSaleQuantityStep,
  type SaleCartItem,
  type SaleCartSummary,
} from '@/features/sales/saleCart';
import { usePriceIncludesTax } from '@/features/pricing/PricingContext';
import { formatQuantity } from './posTouchQuantity';

/**
 * Forward-compatible loyalty profile shape. The customers schema
 * does not carry this today;  will land it.  V1
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
  priceTier?: 1 | 2 | 3;
  loyaltyProfile?: PosTouchLoyaltyProfile | null;
}

interface PosTouchCartSidebarProps {
  items: SaleCartItem[];
  summary: SaleCartSummary;
  customer: PosTouchCustomer | null;
  customers: PosTouchCustomer[];
  priceTier: 1 | 2 | 3;
  canCharge: boolean;
  chargeDisabledReason: 'noSite' | 'noSession' | 'noItems' | null;
  isCharging: boolean;
  /** Shown above Cobrar only where the site can issue an electronic invoice. */
  electronicInvoice?: ReactNode;
  onClearCart: () => void;
  onCustomerChange: (customerId: string) => void;
  onPriceTierChange: (tier: 1 | 2 | 3) => void;
  onUpdateQuantity?: ((key: string, quantity: number) => void) | undefined;
  onUnitChange?: ((key: string, unitId: string) => void) | undefined;
  onRemoveLine: (key: string) => void;
  onCharge: () => void;
  onOpenCashSession?: (() => void) | undefined;
}

export function PosTouchCartSidebar({
  items,
  summary,
  customer,
  customers,
  priceTier,
  canCharge,
  chargeDisabledReason,
  isCharging,
  electronicInvoice,
  onClearCart,
  onCustomerChange,
  onPriceTierChange,
  onUpdateQuantity,
  onUnitChange,
  onRemoveLine,
  onCharge,
  onOpenCashSession,
}: PosTouchCartSidebarProps) {
  const { t, i18n } = useTranslation('posTouch');
  const priceIncludesTax = usePriceIncludesTax();
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
      aria-busy={isCharging}
      className="flex flex-col gap-3 rounded-xl border border-line/70 bg-surface-1 p-4 lg:max-h-full lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:scroll-pb-36 scrollbar-thin"
    >
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.18em] text-secondary-500">{t('cart.title')}</p>
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
        <select
          className="input min-h-[44px] w-full"
          aria-label={t('cart.customer')}
          value={customer?.id ?? ''}
          disabled={isCharging}
          onChange={event => onCustomerChange(event.target.value)}
        >
          <option value="">{t('cart.customerPlaceholder')}</option>
          {customers.map(option => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label={t('cart.priceTier.label')}>
          {([1, 2, 3] as const).map(tier => (
            <button
              key={tier}
              type="button"
              aria-pressed={tier === priceTier}
              disabled={isCharging}
              className={`min-h-[44px] rounded-md border text-xs font-medium ${
                tier === priceTier
                  ? 'border-primary-800 bg-primary-800 text-primary-foreground'
                  : 'border-line/70 bg-surface-1 text-secondary-700'
              }`}
              onClick={() => onPriceTierChange(tier)}
            >
              {t('cart.priceTier.option', { tier })}
            </button>
          ))}
        </div>
        {customer && (customer.priceTier ?? 1) !== priceTier && (
          <button
            type="button"
            className="min-h-[44px] w-full rounded-md border border-primary-300 bg-primary-50 px-3 text-xs font-medium text-primary-800"
            disabled={isCharging}
            onClick={() => onPriceTierChange(customer.priceTier ?? 1)}
          >
            {t('cart.priceTier.applyCustomer', { tier: customer.priceTier ?? 1 })}
          </button>
        )}
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
              disabled={isCharging}
              className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-md border border-warning-300 bg-surface-1 px-2 py-1 text-xs font-medium text-warning-700 hover:bg-warning-50"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {t('cart.loyalty.sumarPuntos')}
            </button>
            <p className="text-[11px] text-warning-600">{t('cart.loyalty.sumarPuntosHelp')}</p>
          </div>
        ) : null}
      </section>

      <section className="space-y-1">
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
              // Same shared split as the footer summary, so in exclusive
              // mode the visible line rows still sum to the total due.
              const lineTotal = getLineTotals(item, priceIncludesTax).total;
              const minQty = getSaleMinimumQuantity(item);
              const qtyStep = getSaleQuantityStep(item);
              const lineLabel = item.unitName
                ? `${item.productName} (${item.unitName})`
                : item.productName;
              const canSwitchUnit = Boolean(onUnitChange) && canChangeCartItemUnit(item);
              return (
                <li
                  key={item.key}
                  data-testid={`pos-touch-cart-line-${item.key}`}
                  className="flex flex-col gap-2 rounded-md border border-line/40 bg-surface-1 p-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-secondary-900">
                        {item.productName}
                      </p>
                      <p className="text-[11px] tabular-nums text-secondary-500">
                        {formatQuantity(item.quantity, i18n.language)} {item.unitName} ·{' '}
                        {formatCurrency(item.unitPrice)}
                      </p>
                    </div>
                    <span className="font-display text-sm tabular-nums text-secondary-900">
                      {formatCurrency(lineTotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1.5">
                    {onUpdateQuantity ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          data-testid={`pos-touch-cart-line-${item.key}-decrement`}
                          aria-label={t('cart.lineDecrementAriaLabel', { name: lineLabel })}
                          disabled={isCharging || item.quantity <= minQty}
                          onClick={() =>
                            onUpdateQuantity(
                              item.key,
                              Math.max(minQty, Number((item.quantity - qtyStep).toFixed(6)))
                            )
                          }
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line/70 text-secondary-700 hover:bg-surface-2 disabled:opacity-40"
                        >
                          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <span className="min-w-[2.25rem] text-center text-sm font-semibold tabular-nums text-secondary-900">
                          {formatQuantity(item.quantity, i18n.language)}
                        </span>
                        <button
                          type="button"
                          data-testid={`pos-touch-cart-line-${item.key}-increment`}
                          aria-label={t('cart.lineIncrementAriaLabel', { name: lineLabel })}
                          disabled={isCharging}
                          onClick={() =>
                            onUpdateQuantity(item.key, Number((item.quantity + qtyStep).toFixed(6)))
                          }
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line/70 text-secondary-700 hover:bg-surface-2 disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <span />
                    )}
                    <div className="flex min-w-0 items-center gap-1.5">
                      {canSwitchUnit && item.unitOptions && (
                        <select
                          data-testid={`pos-touch-cart-line-${item.key}-unit`}
                          aria-label={t('cart.lineUnitAriaLabel', { name: item.productName })}
                          className="input min-h-[44px] max-w-[7.5rem] py-1 text-xs"
                          value={item.unitId}
                          disabled={isCharging}
                          onChange={event => onUnitChange?.(item.key, event.target.value)}
                        >
                          {item.unitOptions.map(option => (
                            <option key={option.unitId} value={option.unitId}>
                              {option.unitName}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        data-testid={`pos-touch-cart-line-${item.key}-remove`}
                        aria-label={t('cart.lineRemoveAriaLabel', { name: lineLabel })}
                        disabled={isCharging}
                        onClick={() => onRemoveLine(item.key)}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line/70 text-secondary-500 hover:border-danger-300 hover:bg-danger-50 hover:text-danger-700"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
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

      {electronicInvoice}

      <footer className="sticky bottom-0 flex flex-col gap-2 bg-surface-1 pt-2">
        {chargeDisabledReason === 'noSession' && onOpenCashSession ? (
          <button
            type="button"
            data-testid="pos-touch-open-cash-session"
            onClick={onOpenCashSession}
            disabled={isCharging}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-base font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            <WalletCards className="h-4 w-4" aria-hidden="true" />
            {t('cart.openCashSession')}
          </button>
        ) : (
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
        )}
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
            disabled={isCharging}
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
