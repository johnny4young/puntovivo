/** One single tender: cash with its change, or a card, transfer or other payment with its proof. */
import { lazy, Suspense, useState } from 'react';
import { CheckCircle2, Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';

import { cn, formatCurrency } from '@/lib/utils';
import type { PaymentMethod } from '@/types';
import { applyKeypadKey, breakdownChange } from './cashTender';
import { QuickDenominationSelector } from './QuickDenominationSelector';
import { SalePaymentKeypad } from './SalePaymentKeypad';
import type { SalePaymentValues } from './salePaymentModal.types';

const SaleCashDrawerHint = lazy(async () => {
  const module = await import('./SaleCashDrawerHint');
  return { default: module.SaleCashDrawerHint };
});

const SaleTransferPanel = lazy(async () => {
  const module = await import('./SaleTransferPanel');
  return { default: module.SaleTransferPanel };
});

interface SalePaymentSingleTenderSectionProps {
  form: UseFormReturn<SalePaymentValues>;
  paymentMethod: PaymentMethod;
  isCash: boolean;
  isAdmin: boolean;
  grandTotal: number;
  amountReceivedValue: number;
  change: number;
  outstanding: number;
  currencyCode: string;
  transferReferenceMissing: boolean;
}

const CAP_CLASS = 'text-xs font-semibold uppercase tracking-[0.14em] text-fg3';
const FIELD_CLASS =
  'h-[52px] w-full rounded-[13px] border-[1.5px] border-line-strong bg-background px-3.5 text-base font-semibold text-foreground outline-none focus-visible:border-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500/40';

export function SalePaymentSingleTenderSection({
  form,
  paymentMethod,
  isCash,
  isAdmin,
  grandTotal,
  amountReceivedValue,
  change,
  outstanding,
  currencyCode,
  transferReferenceMissing,
}: SalePaymentSingleTenderSectionProps) {
  const { t } = useTranslation('sales');
  // A preset amount is replaced by the first keypad digit instead of extended.
  const [amountIsPreset, setAmountIsPreset] = useState(true);
  const isShort = outstanding > 0;
  const isTransfer = paymentMethod === 'transfer';

  const setAmount = (amount: number) =>
    form.setValue('amountReceived', amount, { shouldDirty: true, shouldValidate: true });

  const amountRegistration = form.register('amountReceived', {
    valueAsNumber: true,
    min: { value: 0, message: t('payment.amountNegative') },
    onChange: () => setAmountIsPreset(false),
  });
  const amountError = form.formState.errors.amountReceived && (
    <p className="mt-1 text-sm text-danger-600" role="alert">
      {form.formState.errors.amountReceived.message}
    </p>
  );

  if (!isCash) {
    const reference = form.formState.errors.paymentReference;
    return (
      <div className="space-y-4">
        {isTransfer && (
          <Suspense fallback={null}>
            <SaleTransferPanel isAdmin={isAdmin} />
          </Suspense>
        )}
        <div>
          <label htmlFor="sale-payment-reference" className={cn(CAP_CLASS, 'mb-1.5 block')}>
            {t(isTransfer ? 'payment.transferReference' : 'payment.reference')}
          </label>
          <div className="relative">
            <input
              id="sale-payment-reference"
              type="text"
              autoComplete="off"
              maxLength={120}
              className={cn(FIELD_CLASS, 'pr-11 font-mono tracking-[0.12em]')}
              aria-required={isTransfer}
              aria-invalid={reference ? true : undefined}
              data-testid="sale-payment-reference"
              {...form.register('paymentReference')}
            />
            {isTransfer && !transferReferenceMissing && (
              <CheckCircle2
                className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-success-700"
                aria-hidden="true"
              />
            )}
          </div>
        </div>
        {isTransfer && (
          <p className="flex items-start gap-2.5 rounded-[13px] bg-surface-3 px-3.5 py-3 text-sm text-fg2">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('payment.transferPanel.manualNote')}
          </p>
        )}
        <div>
          <label htmlFor="sale-payment-amount" className={cn(CAP_CLASS, 'mb-1.5 block')}>
            {t('payment.amountReceived')}
          </label>
          <input
            id="sale-payment-amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className={cn(FIELD_CLASS, 'font-numeric text-xl')}
            {...amountRegistration}
          />
          {amountError}
        </div>
        {isShort && (
          <dl
            data-testid="payment-settlement"
            className="flex items-center justify-between gap-3 rounded-[15px] bg-warning-50 px-4 py-3"
          >
            <dt className="text-sm font-semibold text-warning-700">{t('payment.balance')}</dt>
            <dd
              data-testid="payment-settlement-amount"
              className="font-numeric text-2xl text-warning-700"
            >
              {formatCurrency(outstanding)}
            </dd>
          </dl>
        )}
      </div>
    );
  }

  const breakdown = isShort ? null : breakdownChange(change, currencyCode);

  return (
    <div className="space-y-3">
      <p className={CAP_CLASS}>{t('payment.cashPrompt')}</p>
      {grandTotal > 0 && (
        <QuickDenominationSelector
          total={grandTotal}
          currentValue={amountReceivedValue}
          currencyCode={currencyCode}
          onSelect={amount => {
            setAmountIsPreset(true);
            setAmount(amount);
          }}
        />
      )}

      <div className="rounded-[18px] border-[2.5px] border-primary-700 bg-background px-4 pb-2 pt-3 shadow-[0_0_0_4px_var(--accent)]">
        <label htmlFor="sale-payment-amount" className={cn(CAP_CLASS, 'block')}>
          {t('payment.amountReceived')}
        </label>
        <input
          id="sale-payment-amount"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          className="font-numeric w-full bg-transparent text-5xl leading-tight text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          {...amountRegistration}
        />
      </div>
      {amountError}

      <div className="hidden sm:block">
        <SalePaymentKeypad
          onKey={key => {
            const current = Number(form.getValues('amountReceived')) || 0;
            setAmount(applyKeypadKey(current, key, amountIsPreset));
            setAmountIsPreset(false);
          }}
        />
      </div>

      <div
        data-testid="payment-settlement"
        className={cn('rounded-[20px] px-5 py-4', isShort ? 'bg-warning-50' : 'bg-success-50')}
      >
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p
              className={cn(
                'text-xs font-semibold uppercase tracking-[0.14em]',
                isShort ? 'text-warning-700' : 'text-success-700'
              )}
            >
              {isShort ? t('payment.balance') : t('payment.changeDue')}
            </p>
            {!isShort && change > 0 && (
              <Suspense fallback={null}>
                <SaleCashDrawerHint />
              </Suspense>
            )}
          </div>
          <p
            data-testid="payment-settlement-amount"
            className={cn(
              'font-numeric text-5xl leading-none wrap-anywhere sm:text-7xl',
              isShort ? 'text-warning-700' : 'text-success-700'
            )}
          >
            {formatCurrency(isShort ? outstanding : change)}
          </p>
        </div>
        {breakdown && (
          <div
            className="mt-3 flex flex-wrap items-center gap-2 text-sm text-fg2"
            data-testid="change-breakdown"
          >
            <span id="sale-payment-change-breakdown-label">
              {t('payment.changeBreakdown.label')}
            </span>
            <ul
              className="flex flex-wrap gap-2"
              aria-labelledby="sale-payment-change-breakdown-label"
            >
              {breakdown.notes.map(note => (
                <li
                  key={note.value}
                  className="rounded-full bg-surface px-2.5 py-1 font-semibold text-foreground"
                >
                  {t('payment.changeBreakdown.note', {
                    quantity: note.count,
                    amount: formatCurrency(note.value),
                  })}
                </li>
              ))}
              {breakdown.coins > 0 && (
                <li className="rounded-full bg-surface px-2.5 py-1 font-semibold text-foreground">
                  {t('payment.changeBreakdown.coins', {
                    amount: formatCurrency(breakdown.coins),
                  })}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
