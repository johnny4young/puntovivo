/** Split state of the charge sheet. Rows key on `field.id` so focus survives array edits. */
import { useState } from 'react';
import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  Gift,
  MoreHorizontal,
  Plus,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWatch, type UseFieldArrayReturn, type UseFormReturn } from 'react-hook-form';

import { sumBy } from '@/lib/numbers';
import { roundMoney } from '@/lib/money';
import { formatCurrency } from '@/lib/utils';
import type { SalePaymentValues, SplitTenderMethod } from './salePaymentModal.types';
import { TENDER_SUM_EPSILON } from './salePaymentModal.constants';

const TENDER_ICONS: Record<SplitTenderMethod, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  transfer: ArrowLeftRight,
  credit: UserRound,
  loyalty: Gift,
  store_credit: Wallet,
  other: MoreHorizontal,
};

const REFERENCE_PLACEHOLDERS: Partial<Record<SplitTenderMethod, string>> = {
  card: 'payment.splitReferenceCard',
  transfer: 'payment.splitReferenceTransfer',
  other: 'payment.splitReferencePlaceholder',
};

/** Half of the total, in whole units when the total has no cents. */
function halfOf(total: number): number {
  return Number.isInteger(total) ? Math.ceil(total / 2) : roundMoney(total / 2);
}

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
  // The row «Lo que falta» fills: the last one the cashier touched.
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const rowCount = tenderFields.fields.length;
  const activeIndex = activeRow !== null && activeRow < rowCount ? activeRow : rowCount - 1;
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
  const hasLoyaltyRow = watchedTenders.some(tender => tender.method === 'loyalty');
  const activeIsLoyalty = watchedTenders[activeIndex]?.method === 'loyalty';
  let settledProblem: string | null = null;
  if (isSettled && !splitIsValid && customerValueTenderError === null) {
    settledProblem = rowCount < 2 ? 'payment.splitNeedsTwo' : 'payment.splitZeroRow';
  }

  const setAmount = (index: number, amount: number) =>
    form.setValue(`tenders.${index}.amount`, amount, { shouldDirty: true, shouldValidate: true });

  const fillMissing = () => {
    const current = Number(form.getValues(`tenders.${activeIndex}.amount`)) || 0;
    setAmount(activeIndex, Math.max(0, roundMoney(current - tenderDelta)));
  };

  const splitInHalf = () => {
    const half = halfOf(grandTotal);
    if (rowCount < 2) {
      tenderFields.append({ method: 'card', amount: 0, reference: '' });
    }
    setAmount(0, half);
    setAmount(1, roundMoney(grandTotal - half));
  };

  return (
    <section className="space-y-3" aria-labelledby="sale-split-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="sale-split-heading" className="sale-pay-step-title">
          {t('payment.splitHeading')}
        </h3>
        <button
          type="button"
          className="btn-ghost text-sm text-secondary-700"
          onClick={handleDisableSplit}
        >
          {t('payment.splitDisable')}
        </button>
      </div>

      <div className="space-y-2">
        {tenderFields.fields.map((field, index) => {
          const method = watchedTenders[index]?.method ?? field.method;
          const MethodIcon = TENDER_ICONS[method];
          const referencePlaceholder = REFERENCE_PLACEHOLDERS[method];
          const methodRegistration = form.register(`tenders.${index}.method` as const);
          const pointsRegistration = form.register(`tenders.${index}.loyaltyPoints` as const, {
            setValueAs: value => {
              const parsed = Number(value);
              return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
            },
          });
          return (
            <div
              key={field.id}
              className="sale-pay-tender-row"
              data-active={index === activeIndex && rowCount > 1 ? '' : undefined}
              data-testid={`split-tender-row-${index}`}
              onFocusCapture={() => setActiveRow(index)}
            >
              <MethodIcon className="sale-pay-tender-icon" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <select
                  className="sale-pay-tender-method"
                  aria-label={t('payment.splitMethodLabel', { index: index + 1 })}
                  {...methodRegistration}
                  onChange={event => {
                    void methodRegistration.onChange(event);
                    const nextMethod = event.target.value as SplitTenderMethod;
                    const currentRows = form.getValues('tenders');
                    const otherTotal = sumBy(
                      currentRows.filter((_, rowIndex) => rowIndex !== index),
                      tender => Number(tender.amount) || 0
                    );
                    const remaining = Math.max(0, grandTotal - otherTotal);
                    if (!REFERENCE_PLACEHOLDERS[nextMethod]) {
                      form.setValue(`tenders.${index}.reference`, '', { shouldDirty: true });
                    }
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
                  {/* Same gate as the single tender; the server enforces it too. */}
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
                    className="sale-pay-tender-ref"
                    {...pointsRegistration}
                    onChange={event => {
                      void pointsRegistration.onChange(event);
                      const points = Number(event.target.value) || 0;
                      setAmount(index, roundMoney(points * loyaltyValuePerPoint));
                    }}
                  />
                ) : (
                  referencePlaceholder && (
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder={t(referencePlaceholder)}
                      aria-label={t('payment.splitReferenceLabel', { index: index + 1 })}
                      className="sale-pay-tender-ref"
                      {...form.register(`tenders.${index}.reference` as const)}
                    />
                  )
                )}
              </div>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder={t('payment.splitAmountPlaceholder')}
                aria-label={t('payment.splitAmountLabel', { index: index + 1 })}
                className="sale-pay-tender-amount"
                readOnly={method === 'loyalty'}
                aria-readonly={method === 'loyalty'}
                {...form.register(`tenders.${index}.amount` as const, {
                  // Field arrays with valueAsNumber turn a cleared input into NaN.
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
                className="btn-ghost shrink-0 p-2"
                onClick={() => {
                  tenderFields.remove(index);
                  setActiveRow(null);
                }}
                aria-label={t('payment.splitRemove', { index: index + 1 })}
                disabled={rowCount <= 1}
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
          className="btn-secondary sale-pay-split-action"
          onClick={() => {
            tenderFields.append({
              method: 'card',
              amount: Math.max(0, roundMoney(-tenderDelta)),
              reference: '',
            });
            setActiveRow(rowCount);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('payment.splitAddTender')}
        </button>
        <button
          type="button"
          className="btn-secondary sale-pay-split-action"
          onClick={fillMissing}
          disabled={isSettled || activeIsLoyalty}
          data-testid="split-fill-missing"
        >
          {t('payment.splitFillMissing')}
        </button>
        {rowCount <= 2 && !hasLoyaltyRow && grandTotal > 0 && (
          <button
            type="button"
            className="btn-secondary sale-pay-split-action"
            onClick={splitInHalf}
            data-testid="split-half"
          >
            {t('payment.splitHalf')}
          </button>
        )}
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

      <dl className="sale-pay-kv" data-testid="split-meter">
        <div>
          <dt>{t('payment.splitSum')}</dt>
          <dd>{formatCurrency(tenderSum)}</dd>
        </div>
        <div data-tone={isSettled ? 'ok' : 'danger'}>
          <dt>{isOver ? t('payment.splitOver') : t('payment.splitRemaining')}</dt>
          <dd data-testid="split-remaining" aria-live="polite">
            {formatCurrency(Math.abs(isSettled ? 0 : tenderDelta))}
          </dd>
        </div>
      </dl>

      {settledProblem && (
        <p className="text-sm text-secondary-700" role="status" data-testid="split-problem">
          {t(settledProblem)}
        </p>
      )}
    </section>
  );
}
