/**
 * Tip / propina section of the sale payment modal ().
 *
 * JSX extracted verbatim from the former single-file
 * `SalePaymentModal.tsx`. Presentational: receives the RHF `form` plus the
 * preset/sync handlers from `useSalePaymentModal`; owns no state.
 *
 * @module features/sales/SalePaymentTipSection
 */
import { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';

import type { SalePaymentValues } from './salePaymentModal.types';
import { TIP_PRESETS, coerceTipAmount } from './salePaymentModal.constants';

interface SalePaymentTipSectionProps {
  form: UseFormReturn<SalePaymentValues>;
  presetActive: (percentage: number) => boolean;
  handleTipPreset: (percentage: number) => void;
  syncPaymentInputsForTip: (nextTipAmount: number) => void;
}

export function SalePaymentTipSection({
  form,
  presetActive,
  handleTipPreset,
  syncPaymentInputsForTip,
}: SalePaymentTipSectionProps) {
  const { t } = useTranslation('sales');

  return (
    <div className="rounded-xl border border-secondary-200 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-secondary-900">{t('payment.tip.heading')}</p>
        <p className="text-xs text-secondary-500">{t('payment.tip.helper')}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {TIP_PRESETS.map(preset => (
          <button
            key={preset}
            type="button"
            aria-pressed={presetActive(preset)}
            className={
              presetActive(preset)
                ? 'btn-primary px-3 py-1.5 text-sm'
                : 'btn-secondary px-3 py-1.5 text-sm'
            }
            onClick={() => handleTipPreset(preset)}
          >
            {preset === 0
              ? t('payment.tip.presetZero')
              : t('payment.tip.presetPercentage', { percentage: preset })}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <label htmlFor="sale-payment-tip-custom" className="label">
          {t('payment.tip.customLabel')}
        </label>
        <input
          id="sale-payment-tip-custom"
          type="number"
          min={0}
          step="0.01"
          className="input mt-1"
          placeholder={t('payment.tip.customPlaceholder')}
          {...form.register('tipAmount', {
            // Mirror the split-tender setValueAs — RHF + valueAsNumber
            // turns cleared inputs into NaN, which would propagate
            // into `grandTotal = total + NaN` and the split-tender
            // Σ comparison. Normalize empty / NaN to 0 at register
            // time so the rest of the form stays numeric.
            setValueAs: coerceTipAmount,
            min: { value: 0, message: t('payment.amountNegative') },
            onChange: event => {
              // Switching to a custom amount detaches from the
              // preset state; we mark `tipMethod='fixed'` so the
              // server can distinguish percentage vs fixed for
              // reporting. Zero amount falls back to `null` at
              // submit time.
              syncPaymentInputsForTip(coerceTipAmount(event.target.value));
              form.setValue('tipMethod', 'fixed', { shouldDirty: true });
            },
          })}
        />
        {form.formState.errors.tipAmount && (
          <p className="mt-1 text-sm text-danger-500" role="alert">
            {form.formState.errors.tipAmount.message}
          </p>
        )}
      </div>
    </div>
  );
}
