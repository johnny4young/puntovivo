/**
 * Split-tender section of the sale payment modal ().
 *
 * JSX extracted verbatim from the former single-file
 * `SalePaymentModal.tsx`. Presentational: receives the RHF `form` + the tender
 * field array + derived sums from `useSalePaymentModal`. Rows key on
 * `field.id` (NOT index) so focus survives array mutations.
 *
 * @module features/sales/SalePaymentSplitTenderSection
 */
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWatch, type UseFieldArrayReturn, type UseFormReturn } from 'react-hook-form';

import { sumBy } from '@/lib/numbers';
import { roundMoney } from '@/lib/money';
import { formatCurrency } from '@/lib/utils';
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
  handleDisableSplit: () => void;
}

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
  handleDisableSplit,
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

  return (
    <div className="space-y-3 rounded-xl border border-secondary-200 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-secondary-900">{t('payment.splitHeading')}</p>
        <button
          type="button"
          className="btn-ghost text-xs text-secondary-600"
          onClick={handleDisableSplit}
        >
          {t('payment.splitDisable')}
        </button>
      </div>
      <p className="text-xs text-secondary-500">{t('payment.splitHelp')}</p>

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
            // `field.id` is react-hook-form's stable UUID for this row.
            // Using it alone (not composed with `index`) keeps DOM nodes
            // stable across removes/reorders so focus and transient input
            // state survive array mutations.
            <div
              key={field.id}
              className="grid gap-2 md:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <select
                className="input"
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
                    form.setValue(
                      `tenders.${index}.amount`,
                      roundMoney(points * loyaltyValuePerPoint),
                      {
                        shouldDirty: true,
                        shouldValidate: true,
                      }
                    );
                  } else {
                    form.setValue(`tenders.${index}.loyaltyPoints`, undefined, {
                      shouldDirty: true,
                      shouldValidate: false,
                    });
                    if (nextMethod === 'store_credit') {
                      form.setValue(
                        `tenders.${index}.amount`,
                        Math.min(storeCreditBalance, remaining),
                        {
                          shouldDirty: true,
                          shouldValidate: true,
                        }
                      );
                    }
                  }
                }}
              >
                <option value="cash">{t('payment.cash')}</option>
                <option value="card">{t('payment.card')}</option>
                <option value="transfer">{t('payment.transfer')}</option>
                {/* credit option in split tender mirrors
                  the single-tender gate: only managers + admins
                  with an attached customer can pick it. The
                  server enforces the same gate via Zod refine
                  + the credit-limit invariant. */}
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
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder={t('payment.splitAmountPlaceholder')}
                aria-label={t('payment.splitAmountLabel', { index: index + 1 })}
                className="input"
                readOnly={method === 'loyalty'}
                aria-readonly={method === 'loyalty'}
                {...form.register(`tenders.${index}.amount` as const, {
                  // NOTE: single-tender `amountReceived` above uses
                  // `valueAsNumber: true` because it is a plain field.
                  // Field arrays + `valueAsNumber` have known edge cases
                  // around cleared inputs turning into NaN, which then
                  // poisons `Number(NaN) || 0` comparisons downstream and
                  // blocks Confirm. `setValueAs` normalizes empty to 0 at
                  // registration time.
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
              {method === 'loyalty' ? (
                <input
                  type="number"
                  min={1}
                  step={1}
                  max={loyaltyPointsBalance}
                  placeholder={t('customers:checkoutValue.pointsPlaceholder')}
                  aria-label={t('customers:checkoutValue.pointsLabel', { index: index + 1 })}
                  className="input"
                  {...pointsRegistration}
                  onChange={event => {
                    void pointsRegistration.onChange(event);
                    const points = Number(event.target.value) || 0;
                    form.setValue(
                      `tenders.${index}.amount`,
                      roundMoney(points * loyaltyValuePerPoint),
                      { shouldDirty: true, shouldValidate: true }
                    );
                  }}
                />
              ) : (
                <input
                  type="text"
                  placeholder={t('payment.splitReferencePlaceholder')}
                  aria-label={t('payment.splitReferenceLabel', { index: index + 1 })}
                  className="input"
                  {...form.register(`tenders.${index}.reference` as const)}
                />
              )}
              <button
                type="button"
                className="btn-ghost justify-self-start p-2"
                onClick={() => tenderFields.remove(index)}
                aria-label={t('payment.splitRemove', { index: index + 1 })}
                disabled={tenderFields.fields.length <= 1}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {hasCustomer && (loyaltyPointsBalance > 0 || storeCreditBalance > 0) && (
        <div className="surface-panel-muted grid gap-1 text-xs sm:grid-cols-2">
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
        <div className="rounded-lg border border-danger-200 bg-danger-50 p-3" role="alert">
          <p className="text-xs text-danger-700">{t(customerValueTenderError)}</p>
          {customerValueUnavailable && (
            <button type="button" className="btn-ghost mt-1 text-xs" onClick={retryCustomerValue}>
              {t('customers:checkoutValue.retry')}
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        className="btn-secondary inline-flex items-center gap-2 text-sm"
        onClick={() => {
          const currentTenderSum = sumBy(
            form.getValues('tenders'),
            tender => Number(tender.amount) || 0
          );
          tenderFields.append({
            method: 'card',
            amount: Math.max(0, grandTotal - currentTenderSum),
            reference: '',
          });
        }}
      >
        <Plus className="h-4 w-4" />
        {t('payment.splitAddTender')}
      </button>

      <div className="surface-panel-muted text-sm">
        <div className="flex items-center justify-between">
          <span className="text-secondary-500">{t('payment.splitSum')}</span>
          <span className="font-medium text-secondary-900">{formatCurrency(tenderSum)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-secondary-500">{t('payment.splitDelta')}</span>
          <span
            className={
              Math.abs(tenderDelta) < TENDER_SUM_EPSILON
                ? 'font-medium text-success-600'
                : 'font-medium text-danger-600'
            }
          >
            {tenderDelta >= 0 ? '+' : ''}
            {formatCurrency(tenderDelta)}
          </span>
        </div>
      </div>

      {!splitIsValid && (
        <p className="text-xs text-secondary-500" role="status" aria-live="polite">
          {t('payment.splitMustMatch')}
        </p>
      )}
    </div>
  );
}
