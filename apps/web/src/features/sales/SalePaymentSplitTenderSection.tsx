/** Split state of the payment sheet: several tenders that must add up to the total. */
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWatch, type UseFieldArrayReturn, type UseFormReturn } from 'react-hook-form';

import { sumBy } from '@/lib/numbers';
import { roundMoney } from '@/lib/money';
import { cn, formatCurrency } from '@/lib/utils';
import type { SalePaymentValues } from './salePaymentModal.types';
import { TENDER_SUM_EPSILON } from './salePaymentModal.constants';

interface SalePaymentSplitTenderSectionProps {
  form: UseFormReturn<SalePaymentValues>;
  tenderFields: UseFieldArrayReturn<SalePaymentValues, 'tenders'>;
  creditMethodAvailable: boolean;
  tenderSum: number;
  tenderDelta: number;
  splitIsValid: boolean;
  grandTotal: number;
  hasCustomer: boolean;
  customerValueLoading: boolean;
  customerValueUnavailable: boolean;
  customerValueTenderError: string | null;
  loyaltyPointsBalance: number;
  loyaltyRedemptionEnabled: boolean;
  loyaltyValuePerPoint: number;
  storeCreditBalance: number;
  retryCustomerValue: () => void;
}

const FIELD_CLASS =
  'h-11 w-full min-w-0 rounded-[11px] border-[1.5px] border-line-strong bg-surface px-3 text-[0.95rem] text-foreground outline-none focus-visible:border-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500/40';
const ACTION_CLASS = 'btn-outline min-h-11 gap-2 px-3.5 text-sm';
const ROW_CLASS =
  'flex min-h-11 items-center justify-between gap-3 border-b-[1.5px] border-line text-[0.95rem] text-fg2';

export function SalePaymentSplitTenderSection({
  form,
  tenderFields,
  creditMethodAvailable,
  tenderSum,
  tenderDelta,
  splitIsValid,
  grandTotal,
  hasCustomer,
  customerValueLoading,
  customerValueUnavailable,
  customerValueTenderError,
  loyaltyPointsBalance,
  loyaltyRedemptionEnabled,
  loyaltyValuePerPoint,
  storeCreditBalance,
  retryCustomerValue,
}: SalePaymentSplitTenderSectionProps) {
  const { t } = useTranslation(['sales', 'customers']);
  const watchedTenders = useWatch({ control: form.control, name: 'tenders' }) ?? [];
  const loyaltyAvailable =
    hasCustomer &&
    !customerValueLoading &&
    !customerValueUnavailable &&
    loyaltyRedemptionEnabled &&
    loyaltyPointsBalance > 0 &&
    loyaltyValuePerPoint > 0 &&
    loyaltyValuePerPoint <= grandTotal;
  const storeCreditAvailable =
    hasCustomer && !customerValueLoading && !customerValueUnavailable && storeCreditBalance > 0;

  const isSettled = Math.abs(tenderDelta) < TENDER_SUM_EPSILON;
  const isOver = !isSettled && tenderDelta > 0;
  const coveredPercent =
    grandTotal > 0 ? Math.min(100, Math.round((tenderSum / grandTotal) * 100)) : 100;

  const currentSum = () => sumBy(form.getValues('tenders'), tender => Number(tender.amount) || 0);
  const setAmount = (index: number, amount: number) =>
    form.setValue(`tenders.${index}.amount`, amount, { shouldDirty: true, shouldValidate: true });

  /** Puts whatever is still unpaid on the last tender the cashier can edit. */
  const fillRemainder = () => {
    const rows = form.getValues('tenders');
    // A loyalty amount is priced from its points, so it cannot absorb a remainder.
    const index = rows.map(tender => tender.method !== 'loyalty').lastIndexOf(true);
    if (index < 0) return;
    const next = roundMoney((Number(rows[index]?.amount) || 0) + (grandTotal - currentSum()));
    if (next > 0) setAmount(index, next);
  };

  const splitInHalves = () => {
    const rows = form.getValues('tenders').filter(tender => tender.method !== 'loyalty');
    const half = roundMoney(grandTotal / 2);
    tenderFields.replace([
      { method: rows[0]?.method ?? 'cash', amount: half, reference: rows[0]?.reference ?? '' },
      {
        method: rows[1]?.method ?? 'card',
        amount: roundMoney(grandTotal - half),
        reference: rows[1]?.reference ?? '',
      },
    ]);
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="font-display text-xl text-foreground">{t('payment.splitHeading')}</p>
        <p className="mt-0.5 text-sm text-fg2">{t('payment.splitHelp')}</p>
      </div>

      <div className="space-y-2">
        {tenderFields.fields.map((field, index) => {
          const method = watchedTenders[index]?.method ?? field.method;
          const methodRegistration = form.register(`tenders.${index}.method` as const);
          const pointsRegistration = form.register(`tenders.${index}.loyaltyPoints` as const, {
            setValueAs: value => {
              const parsed = Number(value);
              return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
            },
          });
          return (
            // Keyed by the field array's own id so focus survives adds and removes.
            <div
              key={field.id}
              className="grid items-center gap-2 rounded-[15px] border-[1.5px] border-line bg-background p-2.5 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_minmax(0,8.5rem)_auto]"
              data-testid={`split-tender-row-${index}`}
            >
              <select
                className={cn(FIELD_CLASS, 'font-semibold')}
                aria-label={t('payment.splitMethodLabel', { index: index + 1 })}
                {...methodRegistration}
                onChange={event => {
                  void methodRegistration.onChange(event);
                  const nextMethod = event.target.value;
                  const currentRows = form.getValues('tenders');
                  const otherTotal = sumBy(
                    currentRows.filter((_, rowIndex) => rowIndex !== index),
                    tender => Number(tender.amount) || 0
                  );
                  const remaining = Math.max(0, grandTotal - otherTotal);
                  if (nextMethod === 'loyalty') {
                    const affordable = Math.floor(remaining / loyaltyValuePerPoint);
                    const points = Math.min(loyaltyPointsBalance, Math.max(1, affordable));
                    form.setValue(`tenders.${index}.loyaltyPoints`, points, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                    setAmount(index, roundMoney(points * loyaltyValuePerPoint));
                  } else {
                    form.setValue(`tenders.${index}.loyaltyPoints`, undefined, {
                      shouldDirty: true,
                      shouldValidate: false,
                    });
                    if (nextMethod === 'store_credit') {
                      setAmount(index, Math.min(storeCreditBalance, remaining));
                    }
                  }
                }}
              >
                <option value="cash">{t('payment.cash')}</option>
                <option value="card">{t('payment.card')}</option>
                <option value="transfer">{t('payment.transfer')}</option>
                {/* Same gate as the single-tender credit tab; the server enforces it too. */}
                {creditMethodAvailable && (
                  <option value="credit" data-testid={`split-tender-credit-option-${index}`}>
                    {t('payment.credit')}
                  </option>
                )}
                {(loyaltyAvailable || method === 'loyalty') && (
                  <option value="loyalty">{t('payment.loyalty')}</option>
                )}
                {(storeCreditAvailable || method === 'store_credit') && (
                  <option value="store_credit">{t('payment.storeCredit')}</option>
                )}
                <option value="other">{t('payment.other')}</option>
              </select>
              {method === 'loyalty' ? (
                <input
                  type="number"
                  min={1}
                  step={1}
                  max={loyaltyPointsBalance}
                  placeholder={t('customers:checkoutValue.pointsPlaceholder')}
                  aria-label={t('customers:checkoutValue.pointsLabel', { index: index + 1 })}
                  className={FIELD_CLASS}
                  {...pointsRegistration}
                  onChange={event => {
                    void pointsRegistration.onChange(event);
                    const points = Number(event.target.value) || 0;
                    setAmount(index, roundMoney(points * loyaltyValuePerPoint));
                  }}
                />
              ) : (
                <input
                  type="text"
                  maxLength={120}
                  placeholder={t('payment.splitReferencePlaceholder')}
                  aria-label={t('payment.splitReferenceLabel', { index: index + 1 })}
                  className={cn(FIELD_CLASS, 'font-mono text-sm')}
                  {...form.register(`tenders.${index}.reference` as const)}
                />
              )}
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder={t('payment.splitAmountPlaceholder')}
                aria-label={t('payment.splitAmountLabel', { index: index + 1 })}
                className={cn(FIELD_CLASS, 'font-numeric text-right text-xl')}
                readOnly={method === 'loyalty'}
                aria-readonly={method === 'loyalty'}
                {...form.register(`tenders.${index}.amount` as const, {
                  // A cleared field-array input would become NaN and block Confirm.
                  setValueAs: value => {
                    if (value === '' || value === null || value === undefined) {
                      return 0;
                    }
                    const parsed = Number(value);
                    return Number.isFinite(parsed) ? parsed : 0;
                  },
                  min: { value: 0, message: t('payment.amountNegative') },
                })}
              />
              <button
                type="button"
                className="btn-ghost btn-icon h-11 w-11 justify-self-end"
                onClick={() => tenderFields.remove(index)}
                aria-label={t('payment.splitRemove', { index: index + 1 })}
                disabled={tenderFields.fields.length <= 1}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={ACTION_CLASS}
          onClick={() =>
            tenderFields.append({
              method: 'card',
              amount: Math.max(0, roundMoney(grandTotal - currentSum())),
              reference: '',
            })
          }
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('payment.splitAddTender')}
        </button>
        <button
          type="button"
          className={ACTION_CLASS}
          onClick={fillRemainder}
          disabled={isSettled}
          data-testid="split-fill-remainder"
        >
          {t('payment.splitFillRemainder')}
        </button>
        <button
          type="button"
          className={ACTION_CLASS}
          onClick={splitInHalves}
          data-testid="split-halves"
        >
          {t('payment.splitHalves')}
        </button>
      </div>

      {hasCustomer && (loyaltyPointsBalance > 0 || storeCreditBalance > 0) && (
        <div className="grid gap-1 rounded-[13px] bg-surface-3 px-3.5 py-2.5 text-sm text-fg2 sm:grid-cols-2">
          <span>
            {t('customers:checkoutValue.pointsAvailable', { count: loyaltyPointsBalance })}
          </span>
          <span>
            {t('customers:checkoutValue.storeCreditAvailable', {
              amount: formatCurrency(storeCreditBalance),
            })}
          </span>
        </div>
      )}

      {customerValueTenderError && (
        <div
          className="rounded-[13px] border-[1.5px] border-danger-500 bg-danger-50 p-3"
          role="alert"
        >
          <p className="text-sm text-danger-700">{t(customerValueTenderError)}</p>
          {customerValueUnavailable && (
            <button
              type="button"
              className="btn-outline mt-2 min-h-11 px-3 text-sm"
              onClick={retryCustomerValue}
            >
              {t('customers:checkoutValue.retry')}
            </button>
          )}
        </div>
      )}

      <div data-testid="split-meter">
        <div className={ROW_CLASS}>
          <span>{t('payment.splitSum')}</span>
          <span className="font-numeric text-xl text-foreground">{formatCurrency(tenderSum)}</span>
        </div>
        <div className={ROW_CLASS}>
          <span>{isOver ? t('payment.splitOver') : t('payment.splitRemaining')}</span>
          <span
            data-testid="split-remaining"
            className={cn(
              'font-numeric text-xl',
              isSettled ? 'text-success-700' : 'text-danger-700'
            )}
          >
            {formatCurrency(Math.abs(isSettled ? 0 : tenderDelta))}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={t('payment.splitSum')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={coveredPercent}
          className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3"
        >
          <div
            className={cn(
              'h-full rounded-full',
              isSettled ? 'bg-success-500' : isOver ? 'bg-danger-500' : 'bg-primary-600'
            )}
            style={{ width: `${coveredPercent}%` }}
          />
        </div>
      </div>

      {!splitIsValid && (
        <p className="text-sm text-fg2" role="status" aria-live="polite">
          {t('payment.splitMustMatch')}
        </p>
      )}
    </div>
  );
}
