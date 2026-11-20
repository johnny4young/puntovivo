import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { quantityForAmount } from '@/features/sales/productSelection';
import type { QuickTile } from '@/features/sales/siteQuickKeys';
import { formatCurrency, formatNumber } from '@/lib/utils';
import type { ProductSearchSelection } from '@/types';

interface QuickKeyValueFormProps {
  tile: QuickTile;
  resolveSelection: (tile: QuickTile) => Promise<ProductSearchSelection | null>;
  onAdd: (selection: ProductSearchSelection, quantity: number) => void;
  onCancel: () => void;
  className?: string | undefined;
}

/** Asks the amount for a «valor…» key and adds the quantity it buys at the catalog price. */
export function QuickKeyValueForm({
  tile,
  resolveSelection,
  onAdd,
  onCancel,
  className = '',
}: QuickKeyValueFormProps) {
  const { t } = useTranslation('salesQuickAccess');
  const errorId = useId();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!(value > 0)) {
      setError(t('value.invalid'));
      return;
    }
    setPending(true);
    try {
      const selection = await resolveSelection(tile);
      if (!selection) {
        setError(t('noSaleUnit'));
        return;
      }
      const result = quantityForAmount(value, selection.price, selection.product);
      if ('error' in result) {
        setError(
          t(`value.${result.error}`, {
            price: formatCurrency(selection.price),
            minimum: 'minimum' in result ? formatNumber(result.minimum) : '',
            unit: selection.unit.unitAbbreviation ?? '',
          })
        );
        return;
      }
      onAdd(selection, result.quantity);
    } catch {
      setError(t('addFailed'));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className={`flex flex-wrap items-end gap-2 rounded-xl bg-accent p-3 ${className}`}
      onSubmit={event => void submit(event)}
      data-testid="sales-quick-value-form"
    >
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold text-fg1">
        {t('value.title', { name: tile.name })}
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          className="input min-h-11"
          value={amount}
          onChange={event => {
            setAmount(event.target.value);
            setError(null);
          }}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          // The form opens from a deliberate tap; typing the amount is the next step.
          autoFocus
          data-testid="sales-quick-value-amount"
        />
      </label>
      <button type="submit" className="btn-primary min-h-11" disabled={pending}>
        {t('value.add')}
      </button>
      <button type="button" className="btn-ghost min-h-11" onClick={onCancel}>
        {t('value.cancel')}
      </button>
      {error && (
        <p id={errorId} className="w-full text-sm text-danger-700" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
