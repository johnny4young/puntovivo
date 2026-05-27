import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn, formatCurrency } from '@/lib/utils';

interface QuickDenominationSelectorProps {
  total: number;
  currentValue: number;
  onSelect: (amount: number) => void;
  /** Token list of base denominations in the tenant currency. Defaults to
   * COP-friendly 10k / 20k / 50k bills; tenants on different currencies
   * can override by passing a prop list down later. */
  denominations?: readonly number[];
}

/**
 * ENG-081 — design-system V4 "Recibido" panel.
 *
 * Renders three smart suggestions plus an "Exact" button so the cashier
 * can mark the amount received with one tap. Suggestions ladder up from
 * the grand total: the next round bill above the total, then +50%, then
 * 2×. "Exact" mirrors the total to drop change to zero.
 *
 * The component never mutates anything itself — it just calls
 * `onSelect(amount)` so the parent form (single tender or split tender)
 * stays the only source of truth for the receipt math.
 */
const DEFAULT_DENOMINATIONS = [10_000, 20_000, 50_000, 100_000] as const;

export function QuickDenominationSelector({
  total,
  currentValue,
  onSelect,
  denominations = DEFAULT_DENOMINATIONS,
}: QuickDenominationSelectorProps) {
  const { t } = useTranslation('sales');

  const suggestions = useMemo(() => {
    if (total <= 0) return [] as number[];
    // Smart suggestions: the smallest denomination >= total, then a
    // bigger one, then 2× the total rounded up to the nearest 1k.
    const sorted = [...denominations].sort((a, b) => a - b);
    // Under `noUncheckedIndexedAccess`, both `find()` and `sorted[i]`
    // return `T | undefined`. Bail to the doubled-total fallback when
    // `denominations` is empty so the rest of the math stays typed
    // as `number`.
    const nextBill = sorted.find(d => d >= total) ?? sorted[sorted.length - 1];
    if (nextBill === undefined) {
      const doubledOnly = Math.ceil((total * 2) / 1_000) * 1_000;
      return [doubledOnly];
    }
    const biggerBill = sorted.find(d => d > nextBill) ?? Math.ceil((nextBill * 1.5) / 1_000) * 1_000;
    const doubled = Math.ceil((total * 2) / 1_000) * 1_000;
    return Array.from(new Set([nextBill, biggerBill, doubled])).filter(v => v >= total).slice(0, 3);
  }, [total, denominations]);

  const isActive = (amount: number) => Math.abs(currentValue - amount) < 0.5;

  return (
    <div data-testid="quick-denomination-selector" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <button
        type="button"
        onClick={() => onSelect(total)}
        className={cn(
          'rounded-2xl border px-3 py-2.5 text-sm font-semibold transition-all',
          isActive(total)
            ? 'border-primary-400 bg-primary-50 text-primary-700'
            : 'border-line-strong/60 bg-surface text-secondary-900 hover:border-primary-300 hover:bg-primary-50/60'
        )}
      >
        <span className="block text-[0.55rem] font-semibold uppercase tracking-[0.24em] text-primary-800">
          {t('payment.quickAmount.exactKicker')}
        </span>
        <span className="mt-0.5 block font-mono text-sm tabular-nums">{formatCurrency(total)}</span>
      </button>
      {suggestions.map(amount => (
        <button
          key={amount}
          type="button"
          onClick={() => onSelect(amount)}
          className={cn(
            'rounded-2xl border px-3 py-2.5 text-sm font-semibold transition-all',
            isActive(amount)
              ? 'border-primary-400 bg-primary-50 text-primary-700'
              : 'border-line-strong/60 bg-surface text-secondary-900 hover:border-primary-300 hover:bg-primary-50/60'
          )}
        >
          <span className="block text-[0.55rem] font-semibold uppercase tracking-[0.24em] text-secondary-500">
            {t('payment.quickAmount.billKicker')}
          </span>
          <span className="mt-0.5 block font-mono text-sm tabular-nums">{formatCurrency(amount)}</span>
        </button>
      ))}
    </div>
  );
}
