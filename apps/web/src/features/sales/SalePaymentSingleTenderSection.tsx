// The hidden <select> stays the registered form control; the tiles only drive setValue.
import { useRef } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';

import type { PaymentMethod } from '@/types';
import { CashKeypad } from './CashKeypad';
import { applyCashKeypadKey, type CashKeypadKey } from './cashTender';
import { QuickDenominationSelector } from './QuickDenominationSelector';
import type { SalePaymentValues } from './salePaymentModal.types';
import { PAYMENT_METHOD_TILES } from './salePaymentModal.constants';

interface SalePaymentSingleTenderSectionProps {
  form: UseFormReturn<SalePaymentValues>;
  paymentMethod: PaymentMethod;
  creditMethodAvailable: boolean;
  isCash: boolean;
  isCredit: boolean;
  grandTotal: number;
  amountReceivedValue: number;
  currencySymbol: string;
  handleEnableSplit: () => void;
}

export function SalePaymentSingleTenderSection({
  form,
  paymentMethod,
  creditMethodAvailable,
  isCash,
  isCredit,
  grandTotal,
  amountReceivedValue,
  currencySymbol,
  handleEnableSplit,
}: SalePaymentSingleTenderSectionProps) {
  const { t } = useTranslation('sales');
  // The last amount the cashier keyed in. Any other value (the default,
  // a bill key, F2) is a preset the next digit replaces.
  const keyedAmountRef = useRef<number | null>(null);
  const amountField = form.register('amountReceived', {
    valueAsNumber: true,
    min: { value: 0, message: t('payment.amountNegative') },
  });

  const setAmount = (amount: number) =>
    form.setValue('amountReceived', amount, { shouldDirty: true, shouldValidate: true });

  const handleKey = (key: CashKeypadKey) => {
    const fresh = keyedAmountRef.current !== amountReceivedValue;
    const next = applyCashKeypadKey(amountReceivedValue, key, fresh);
    keyedAmountRef.current = next;
    setAmount(next);
  };

  return (
    <>
      <div role="group" aria-labelledby="sale-payment-method-label">
        <p id="sale-payment-method-label" className="sales-cap mb-2">
          {t('payment.paymentMethod')}
        </p>
        <div className="sale-pay-tenders">
          {PAYMENT_METHOD_TILES.filter(
            // Credit needs an operational role and an attached customer; the server enforces both.
            tile => tile.method !== 'credit' || creditMethodAvailable
          ).map(tile => {
            const TileIcon = tile.icon;
            return (
              <button
                key={tile.method}
                type="button"
                className="sales-tender-tile sale-pay-tender"
                aria-pressed={paymentMethod === tile.method}
                onClick={() =>
                  form.setValue('paymentMethod', tile.method, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                data-testid={`sale-payment-tender-${tile.method}`}
              >
                <TileIcon className="h-5 w-5" aria-hidden="true" />
                <span>{t(tile.labelKey)}</span>
              </button>
            );
          })}
          <button
            type="button"
            className="sales-tender-tile sale-pay-tender"
            aria-label={t('payment.splitEnable')}
            onClick={handleEnableSplit}
            data-testid="sale-payment-tender-split"
          >
            <LayoutGrid className="h-5 w-5" aria-hidden="true" />
            <span>{t('sell.tender.split')}</span>
          </button>
        </div>
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

      {isCash && grandTotal > 0 && (
        <QuickDenominationSelector
          total={grandTotal}
          currentValue={amountReceivedValue}
          onSelect={amount => {
            keyedAmountRef.current = null;
            setAmount(amount);
          }}
        />
      )}

      {/* Credit sales take their cash part in the credit card's own field. */}
      {!isCredit && (
        <div className="sale-pay-received">
          <label htmlFor="sale-payment-amount" className="sales-cap">
            {t('payment.amountReceived')}
          </label>
          <div className="sale-pay-received-row">
            <span className="sale-pay-received-symbol" aria-hidden="true">
              {currencySymbol}
            </span>
            <input
              id="sale-payment-amount"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              className="sale-pay-received-input"
              {...amountField}
              onChange={event => {
                keyedAmountRef.current = event.target.valueAsNumber;
                void amountField.onChange(event);
              }}
            />
          </div>
        </div>
      )}
      {form.formState.errors.amountReceived && (
        <p className="text-sm text-danger-500" role="alert">
          {form.formState.errors.amountReceived.message}
        </p>
      )}

      {isCash && <CashKeypad onKey={handleKey} />}
    </>
  );
}
