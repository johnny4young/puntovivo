import { Banknote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ariaKeyshortcutsFor, shortcutDisplayFor } from '@/lib/shortcuts';
import { formatCurrency } from '@/lib/utils';
import { suggestCashTenders } from './cashTender';

interface QuickDenominationSelectorProps {
  total: number;
  currentValue: number;
  onSelect: (amount: number) => void;
}

/** Exact plus the round bills a customer is likely to hand over; the parent form owns the value. */
export function QuickDenominationSelector({
  total,
  currentValue,
  onSelect,
}: QuickDenominationSelectorProps) {
  const { t } = useTranslation('sales');
  // Half a cent, so a 2-decimal tender a few cents short never reads as exact.
  const isActive = (amount: number) => Math.abs(currentValue - amount) < 0.005;

  return (
    <div
      role="group"
      aria-labelledby="sale-payment-bills-title"
      data-testid="quick-denomination-selector"
    >
      <p id="sale-payment-bills-title" className="sales-cap mb-2">
        {t('payment.quickAmount.title')}
      </p>
      <div className="sale-pay-bills">
        <button
          type="button"
          className="sale-pay-bill"
          aria-pressed={isActive(total)}
          aria-keyshortcuts={ariaKeyshortcutsFor('sales.fastCash')}
          onClick={() => onSelect(total)}
          data-testid="quick-denomination-exact"
        >
          {t('payment.quickAmount.exact')}
          <kbd className="pv-kbd" aria-hidden="true">
            {shortcutDisplayFor('sales.fastCash')}
          </kbd>
        </button>
        {suggestCashTenders(total, 3).map(amount => (
          <button
            key={amount}
            type="button"
            className="sale-pay-bill"
            aria-pressed={isActive(amount)}
            onClick={() => onSelect(amount)}
            data-testid={`quick-denomination-${amount}`}
          >
            <Banknote className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="sale-pay-bill-amount">{formatCurrency(amount)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
