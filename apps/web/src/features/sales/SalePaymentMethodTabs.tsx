import { LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';

import { cn } from '@/lib/utils';
import type { PaymentMethod } from '@/types';
import type { SalePaymentValues } from './salePaymentModal.types';
import { PAYMENT_METHOD_TILES } from './salePaymentModal.constants';

interface SalePaymentMethodTabsProps {
  form: UseFormReturn<SalePaymentValues>;
  paymentMethod: PaymentMethod;
  splitMode: boolean;
  creditMethodAvailable: boolean;
  onSelectMethod: (method: PaymentMethod) => void;
  onEnableSplit: () => void;
}

const TAB_CLASS =
  'flex min-h-[70px] min-w-fit flex-1 basis-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-2xl border-[1.5px] px-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/**
 * One tab per way to pay, with splitting as the last one. The hidden select
 * stays the registered form control; the tabs are the only group exposed to
 * assistive technology, so the method is announced once.
 */
export function SalePaymentMethodTabs({
  form,
  paymentMethod,
  splitMode,
  creditMethodAvailable,
  onSelectMethod,
  onEnableSplit,
}: SalePaymentMethodTabsProps) {
  const { t } = useTranslation('sales');
  const tabClass = (active: boolean) =>
    cn(
      TAB_CLASS,
      active
        ? 'border-foreground bg-foreground text-background'
        : 'border-line-strong bg-surface text-foreground hover:bg-surface-2'
    );

  return (
    <div>
      <span id="sale-payment-method-label" className="sr-only">
        {t('payment.paymentMethod')}
      </span>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-labelledby="sale-payment-method-label"
      >
        {PAYMENT_METHOD_TILES.filter(
          // Credit is per customer: without one, or for a role that cannot lend, it is not offered.
          tile => tile.method !== 'credit' || creditMethodAvailable
        ).map(tile => {
          const TileIcon = tile.icon;
          const isActive = !splitMode && paymentMethod === tile.method;
          return (
            <button
              key={tile.method}
              type="button"
              className={tabClass(isActive)}
              aria-pressed={isActive}
              onClick={() => onSelectMethod(tile.method)}
              data-testid={`sale-payment-tab-${tile.method}`}
            >
              <TileIcon className="h-5 w-5" aria-hidden="true" />
              <span>{t(tile.labelKey)}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={tabClass(splitMode)}
          aria-pressed={splitMode}
          aria-label={t('payment.splitEnable')}
          onClick={onEnableSplit}
          data-testid="sale-payment-tab-split"
        >
          <LayoutGrid className="h-5 w-5" aria-hidden="true" />
          <span>{t('payment.splitTab')}</span>
        </button>
      </div>
      <select
        id="sale-payment-method"
        hidden
        data-testid="sale-payment-method-select"
        {...form.register('paymentMethod')}
      >
        <option value="cash">{t('payment.cash')}</option>
        <option value="card">{t('payment.card')}</option>
        <option value="transfer">{t('payment.transfer')}</option>
        {creditMethodAvailable && (
          <option value="credit" data-testid="sale-payment-method-credit-option">
            {t('payment.credit')}
          </option>
        )}
        <option value="other">{t('payment.other')}</option>
      </select>
    </div>
  );
}
