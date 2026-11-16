import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn, formatCurrency } from '@/lib/utils';
import { getCashDenominations } from './cashSessionDenominations';
import { leadingNotes, suggestCashAmounts } from './cashTender';

interface QuickDenominationSelectorProps {
  total: number;
  currentValue: number;
  onSelect: (amount: number) => void;
  /** Currency whose notes shape the suggestions. */
  currencyCode?: string | undefined;
}

const CHIP_CLASS =
  'flex min-h-16 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] border-[1.5px] px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/**
 * One-tap amounts for cash: the exact total and the next round amounts a
 * customer is likely to hand over. It only reports the choice; the payment
 * form stays the single owner of the amount received.
 */
export function QuickDenominationSelector({
  total,
  currentValue,
  onSelect,
  currencyCode = 'COP',
}: QuickDenominationSelectorProps) {
  const { t } = useTranslation('sales');
  const suggestions = useMemo(() => suggestCashAmounts(total, currencyCode), [total, currencyCode]);
  const noteColors = getCashDenominations(currencyCode)?.noteColors ?? {};

  // Half a cent, so a 2-decimal tender a few cents short never reads as exact.
  const isActive = (amount: number) => Math.abs(currentValue - amount) < 0.005;
  const chipClass = (amount: number) =>
    cn(
      CHIP_CLASS,
      isActive(amount)
        ? 'border-foreground bg-background text-foreground shadow-[inset_0_0_0_1px_var(--foreground)]'
        : 'border-line-strong bg-surface text-foreground hover:bg-surface-2'
    );

  return (
    <div
      data-testid="quick-denomination-selector"
      className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]"
    >
      <button
        type="button"
        onClick={() => onSelect(total)}
        aria-pressed={isActive(total)}
        className={chipClass(total)}
        data-testid="quick-amount-exact"
      >
        <span className="text-base font-semibold">{t('payment.quickAmount.exactKicker')}</span>
        <kbd className="pv-kbd" aria-hidden="true">
          F2
        </kbd>
        <span className="sr-only">{formatCurrency(total)}</span>
      </button>
      {suggestions.map(amount => {
        const swatch = leadingNotes(amount, currencyCode)
          .map(note => noteColors[note])
          .filter((color): color is string => Boolean(color));
        return (
          <button
            key={amount}
            type="button"
            onClick={() => onSelect(amount)}
            aria-pressed={isActive(amount)}
            className={chipClass(amount)}
            data-testid={`quick-amount-${amount}`}
          >
            {swatch.length > 0 && (
              <span
                aria-hidden="true"
                className="flex h-4 w-7 shrink-0 overflow-hidden rounded-[4px]"
                data-testid="quick-amount-swatch"
              >
                {swatch.map(color => (
                  <span key={color} className="h-full flex-1" style={{ backgroundColor: color }} />
                ))}
              </span>
            )}
            <span className="font-numeric text-lg">{formatCurrency(amount)}</span>
          </button>
        );
      })}
    </div>
  );
}
