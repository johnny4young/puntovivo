/** Tip chips that show the amount each preset adds; «Otro valor» opens a free amount. */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';

import { formatCurrency } from '@/lib/utils';
import type { SalePaymentValues } from './salePaymentModal.types';
import { TIP_PRESETS, coerceTipAmount } from './salePaymentModal.constants';
import { percentOf } from './cashTender';

interface SalePaymentTipSectionProps {
  form: UseFormReturn<SalePaymentValues>;
  /** Amount the percentages apply to: the checkout total before tip. */
  baseTotal: number;
  tipAmount: number;
  presetActive: (percentage: number) => boolean;
  handleTipPreset: (percentage: number) => void;
  syncPaymentInputsForTip: (nextTipAmount: number) => void;
}

export function SalePaymentTipSection({
  form,
  baseTotal,
  tipAmount,
  presetActive,
  handleTipPreset,
  syncPaymentInputsForTip,
}: SalePaymentTipSectionProps) {
  const { t } = useTranslation('sales');
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const isPresetTip = TIP_PRESETS.some(preset => presetActive(preset));
  const [customOpen, setCustomOpen] = useState(false);
  const customActive = customOpen || (tipAmount > 0 && !isPresetTip);
  const { ref: registerRef, ...tipField } = form.register('tipAmount', {
    // RHF turns a cleared number input into NaN; keep the form numeric.
    setValueAs: coerceTipAmount,
    min: { value: 0, message: t('payment.amountNegative') },
    onChange: event => {
      syncPaymentInputsForTip(coerceTipAmount(event.target.value));
      form.setValue('tipMethod', 'fixed', { shouldDirty: true });
    },
  });

  const choosePreset = (preset: number) => {
    setCustomOpen(false);
    handleTipPreset(preset);
  };

  const openCustom = () => {
    setCustomOpen(true);
    // Mounts in this commit; selecting lets the typed amount replace the preset's.
    requestAnimationFrame(() => customInputRef.current?.select());
  };

  return (
    <div className="sale-pay-tip" data-testid="sale-payment-tip">
      <p className="sales-cap" id="sale-payment-tip-heading">
        {t('payment.tip.heading')}
      </p>
      <div
        className="mt-2 flex flex-wrap gap-2"
        role="group"
        aria-labelledby="sale-payment-tip-heading"
      >
        {TIP_PRESETS.map(preset => {
          const active = !customActive && presetActive(preset);
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={active}
              className="modifier-option"
              data-testid={`sale-payment-tip-preset-${preset}`}
              onClick={() => choosePreset(preset)}
            >
              {preset === 0 ? (
                t('payment.tip.presetZero')
              ) : (
                <>
                  {t('payment.tip.presetPercentage', { percentage: preset })}{' '}
                  <small className="tabular-nums">
                    {formatCurrency(percentOf(baseTotal, preset))}
                  </small>
                </>
              )}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={customActive}
          aria-expanded={customActive}
          aria-controls="sale-payment-tip-custom"
          className="modifier-option"
          data-testid="sale-payment-tip-custom-toggle"
          onClick={openCustom}
        >
          {t('payment.tip.custom')}
        </button>
      </div>
      {customActive && (
        <div className="mt-2">
          <label htmlFor="sale-payment-tip-custom" className="sr-only">
            {t('payment.tip.customLabel')}
          </label>
          <input
            id="sale-payment-tip-custom"
            type="number"
            min={0}
            step="0.01"
            className="input"
            placeholder={t('payment.tip.customLabel')}
            data-testid="sale-payment-tip-custom"
            {...tipField}
            ref={element => {
              registerRef(element);
              customInputRef.current = element;
            }}
          />
          {form.formState.errors.tipAmount && (
            <p className="mt-1 text-sm text-danger-500" role="alert">
              {form.formState.errors.tipAmount.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
