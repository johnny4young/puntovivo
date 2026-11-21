/** Credit state of the charge sheet: debt, cupo use and the cash paid now. */
import { CircleAlert } from 'lucide-react';

import { StatusStrip } from '@/components/ui/StatusStrip';
import { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';

import { formatCurrency } from '@/lib/utils';
import type { Customer } from '@/types';
import { cupoShare } from './cupoShare';
import { initialsOf } from './handoff/handoffModel';
import { coerceTipAmount } from './salePaymentModal.constants';
import type { SalePaymentValues } from './salePaymentModal.types';

interface SaleCreditCustomerCardProps {
  form: UseFormReturn<SalePaymentValues>;
  selectedCustomer: Customer | null;
  splitMode: boolean;
  /** The part of this sale that goes on the account. */
  creditAmount: number;
  creditDownPaymentInvalid: boolean;
  /** Cash that would bring the sale back within the cupo; 0 when that cannot help. */
  payableExcess: number;
  onPayExcess: () => void;
  currencySymbol: string;
  currentBalance: number;
  creditLimit: number;
  projectedBalance: number;
  cupoExceeded: boolean;
  isAdmin: boolean;
  balanceLoading: boolean;
  /**
   * The balance read failed, so the cupo projection is unknowable. The card
   * says so and the checkout stays blocked; the cashier would act on a wrong one.
   */
  balanceUnavailable?: boolean | undefined;
  retryBalance?: (() => void) | undefined;
}

export function SaleCreditCustomerCard({
  form,
  selectedCustomer,
  splitMode,
  creditAmount,
  creditDownPaymentInvalid,
  payableExcess,
  onPayExcess,
  currencySymbol,
  currentBalance,
  creditLimit,
  projectedBalance,
  cupoExceeded,
  isAdmin,
  balanceLoading,
  balanceUnavailable = false,
  retryBalance,
}: SaleCreditCustomerCardProps) {
  const { t } = useTranslation('sales');
  const amountOrPending = (amount: number) =>
    // An em dash on failure and an ellipsis while loading, never a made-up 0.
    balanceUnavailable ? '—' : balanceLoading ? '…' : formatCurrency(amount);
  const showBar = creditLimit > 0 && !balanceLoading && !balanceUnavailable;
  const name = selectedCustomer?.name ?? t('credit.card.unknownCustomer');
  const owedShare = cupoShare(currentBalance, creditLimit);
  const saleShare = Math.min(100 - owedShare, cupoShare(creditAmount, creditLimit));

  return (
    <section
      className="space-y-3 rounded-xl border border-line p-4"
      data-testid="credit-sale-customer-card"
      aria-busy={balanceLoading}
      aria-label={t('credit.card.heading', { name })}
    >
      <div className="flex items-center gap-3">
        <span className="sales-avatar sale-pay-avatar" aria-hidden="true">
          {initialsOf(name)}
        </span>
        <div className="min-w-0">
          <p className="sale-pay-step-title truncate">{name}</p>
          {selectedCustomer?.taxId && (
            <p className="text-sm text-secondary-600">{selectedCustomer.taxId}</p>
          )}
        </div>
      </div>

      {balanceUnavailable && (
        <div
          className="rounded-lg border border-danger-200 bg-danger-50 p-3"
          role="alert"
          data-testid="credit-balance-error"
        >
          <p className="text-xs font-medium text-danger-700">
            {t('credit.card.balanceUnavailable')}
          </p>
          <p className="mt-0.5 text-xs text-danger-600">
            {t('credit.card.balanceUnavailableHelp')}
          </p>
          {retryBalance && (
            <button
              type="button"
              className="btn-outline mt-2 h-7 px-2 text-xs"
              onClick={retryBalance}
              data-testid="credit-balance-retry"
            >
              {t('credit.card.balanceRetry')}
            </button>
          )}
        </div>
      )}

      {showBar && (
        <div>
          <div
            className="sale-pay-cupo-bar"
            data-over={cupoExceeded || undefined}
            role="img"
            aria-label={t('credit.card.cupoBar', {
              owed: formatCurrency(currentBalance),
              sale: formatCurrency(creditAmount),
              limit: formatCurrency(creditLimit),
            })}
            data-testid="credit-sale-cupo-bar"
          >
            <span className="sale-pay-cupo-owed" style={{ width: `${owedShare}%` }} />
            <span className="sale-pay-cupo-sale" style={{ width: `${saleShare}%` }} />
          </div>
          <div className="sale-pay-cupo-scale" aria-hidden="true">
            <span>{t('credit.card.owedToday')}</span>
            <span>{t('credit.card.plusThisSale')}</span>
            <span data-testid="credit-sale-cupo">
              {t('credit.card.cupoOf', { amount: formatCurrency(creditLimit) })}
            </span>
          </div>
        </div>
      )}

      <dl className="sale-pay-kv">
        <div data-testid="credit-sale-current-balance">
          <dt>{t('credit.card.balance')}</dt>
          <dd>{amountOrPending(currentBalance)}</dd>
        </div>
        <div data-testid="credit-sale-this-sale">
          <dt>{t('credit.card.thisSale')}</dt>
          <dd>{formatCurrency(creditAmount)}</dd>
        </div>
        <div data-testid="credit-sale-projected" data-tone={cupoExceeded ? 'warning' : undefined}>
          <dt>{t('credit.card.projected')}</dt>
          <dd>{amountOrPending(projectedBalance)}</dd>
        </div>
        {!showBar && (
          <div data-testid="credit-sale-cupo">
            <dt>{t('credit.card.cupo')}</dt>
            <dd>{creditLimit > 0 ? formatCurrency(creditLimit) : t('credit.card.unlimited')}</dd>
          </div>
        )}
      </dl>

      {!splitMode && (
        <div className="grid grid-cols-2 items-end gap-3">
          <div>
            <label htmlFor="sale-credit-down-payment" className="label">
              {t('credit.card.downPayment')}
            </label>
            <div className="sale-pay-money-field mt-1">
              <span aria-hidden="true">{currencySymbol}</span>
              <input
                id="sale-credit-down-payment"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="0"
                data-testid="credit-down-payment"
                aria-invalid={creditDownPaymentInvalid || undefined}
                aria-describedby={
                  creditDownPaymentInvalid ? 'sale-credit-down-payment-error' : undefined
                }
                {...form.register('creditDownPayment', { setValueAs: coerceTipAmount })}
              />
            </div>
          </div>
          <div>
            <p className="label" id="sale-credit-portion-label">
              {t('credit.card.onCredit')}
            </p>
            <output
              className="sale-pay-money-field mt-1"
              data-tone="credit"
              aria-labelledby="sale-credit-portion-label"
              data-testid="credit-sale-credit-portion"
            >
              {formatCurrency(creditAmount)}
            </output>
          </div>
          {creditDownPaymentInvalid && (
            <p
              id="sale-credit-down-payment-error"
              className="col-span-2 text-sm text-danger-700"
              role="alert"
            >
              {t('credit.card.downPaymentTooHigh')}
            </p>
          )}
        </div>
      )}

      {cupoExceeded && (
        <StatusStrip
          tone="warning"
          icon={CircleAlert}
          title={t('credit.warning.exceedsLimit')}
          data-testid="credit-sale-warning"
          action={
            payableExcess > 0 && (
              <button
                type="button"
                className="btn-secondary h-9 whitespace-nowrap px-3 text-sm"
                data-testid="credit-sale-pay-excess"
                onClick={onPayExcess}
              >
                {t('credit.card.payExcess', { amount: formatCurrency(payableExcess) })}
              </button>
            )
          }
        />
      )}
      {/* Admins opt in here; other roles get the payload-bound request panel below. */}
      {cupoExceeded && isAdmin && (
        <label className="flex items-start gap-2 text-sm" data-testid="credit-sale-override-label">
          <input
            type="checkbox"
            className="mt-0.5"
            data-testid="credit-sale-override-toggle"
            {...form.register('creditOverride')}
          />
          <span className="flex flex-col">
            <span className="font-medium">{t('credit.override.label')}</span>
            <span className="text-xs text-secondary-600">{t('credit.override.adminHelp')}</span>
          </span>
        </label>
      )}
    </section>
  );
}
