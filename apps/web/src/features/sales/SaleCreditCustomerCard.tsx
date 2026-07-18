/**
 * Credit-sale customer card of the sale payment modal (ENG-090 + ENG-014).
 *
 * ENG-178 — JSX extracted verbatim from the former single-file
 * `SalePaymentModal.tsx`. Presentational: receives the RHF `form` (for the
 * admin override checkbox) + the projection values from `useSalePaymentModal`.
 * Surfaces in both single-tender credit and split-credit modes.
 *
 * @module features/sales/SaleCreditCustomerCard
 */
import { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';

import { formatCurrency } from '@/lib/utils';
import type { Customer } from '@/types';
import type { SalePaymentValues } from './salePaymentModal.types';

interface SaleCreditCustomerCardProps {
  form: UseFormReturn<SalePaymentValues>;
  selectedCustomer: Customer | null;
  splitMode: boolean;
  creditAmountInSplit: number;
  grandTotal: number;
  currentBalance: number;
  creditLimit: number;
  projectedBalance: number;
  cupoExceeded: boolean;
  isAdmin: boolean;
  balanceLoading: boolean;
  /**
   * ENG-218 — the balance read failed, so the cupo projection below is
   * unknowable. The card says so and the checkout stays blocked; a wrong
   * projection is worse than none, because the cashier acts on it.
   */
  balanceUnavailable?: boolean | undefined;
  /** ENG-218 — retry the balance read. Required with `balanceUnavailable`. */
  retryBalance?: (() => void) | undefined;
}

export function SaleCreditCustomerCard({
  form,
  selectedCustomer,
  splitMode,
  creditAmountInSplit,
  grandTotal,
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

  return (
    <div
      className="rounded-xl border border-secondary-200 p-4"
      data-testid="credit-sale-customer-card"
      aria-busy={balanceLoading}
    >
      <p className="text-sm font-medium text-secondary-900">
        {selectedCustomer?.name ?? t('credit.card.unknownCustomer')}
      </p>
      {selectedCustomer?.taxId && (
        <p className="text-xs text-secondary-500">
          {selectedCustomer.taxId}
        </p>
      )}
      {/* ENG-218 — the balance read failed. Replace the projection with an
          honest error instead of drawing a $0 balance that would read as
          "full cupo available"; Confirm is disabled upstream. Loading is
          also unknown, but stays represented by the compact ellipsis below. */}
      {balanceUnavailable && (
        <div
          className="mt-3 rounded-lg border border-danger-200 bg-danger-50 p-3"
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
      {/* ENG-014 — when split mode pushes a partial credit
          amount, surface a one-line summary so the cashier
          sees the breakdown ("$50 efectivo + $150 a crédito"). */}
      {splitMode && creditAmountInSplit > 0 && (
        <p
          className="mt-2 text-xs text-secondary-600"
          data-testid="credit-sale-partial-summary"
        >
          {t('payment.partialCredit.summary', {
            cashAmount: formatCurrency(grandTotal - creditAmountInSplit),
            creditAmount: formatCurrency(creditAmountInSplit),
          })}
        </p>
      )}
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div
          className={`rounded border p-2 ${
            currentBalance > 0 && !balanceLoading && !balanceUnavailable
              ? 'border-danger-300 bg-danger-50 text-danger-700'
              : 'border-line bg-white text-secondary-900'
          }`}
          data-testid="credit-sale-current-balance"
        >
          <p className="text-xs uppercase tracking-wide text-secondary-500">
            {t('credit.card.balance')}
          </p>
          <p className="mt-1 text-base font-medium tabular-nums">
            {/* ENG-218 — an em dash on failure and an ellipsis while loading,
                never a formatted 0 while the balance is unknown. */}
            {balanceUnavailable ? '—' : balanceLoading ? '…' : formatCurrency(currentBalance)}
          </p>
        </div>
        <div
          className="rounded border border-line bg-white p-2 text-secondary-900"
          data-testid="credit-sale-cupo"
        >
          <p className="text-xs uppercase tracking-wide text-secondary-500">
            {t('credit.card.cupo')}
          </p>
          <p className="mt-1 text-base font-medium tabular-nums">
            {creditLimit > 0
              ? formatCurrency(creditLimit)
              : t('credit.card.unlimited')}
          </p>
        </div>
        <div
          className={`rounded border p-2 ${cupoExceeded ? 'border-warning-300 bg-warning-50 text-warning-700' : 'border-line bg-white text-secondary-900'}`}
          data-testid="credit-sale-projected"
        >
          <p className="text-xs uppercase tracking-wide text-secondary-500">
            {t('credit.card.projected')}
          </p>
          <p className="mt-1 text-base font-medium tabular-nums">
            {balanceUnavailable ? '—' : balanceLoading ? '…' : formatCurrency(projectedBalance)}
          </p>
        </div>
      </div>
      {cupoExceeded && (
        <p
          className="mt-3 text-sm text-warning-700"
          data-testid="credit-sale-warning"
        >
          {t('credit.warning.exceedsLimit')}
        </p>
      )}
      {/* Override checkbox: admin only, only when the
          projection actually exceeds the cupo. Submitting
          without it raises the server-side
          CREDIT_LIMIT_EXCEEDED toast. */}
      {cupoExceeded && (
        <label
          className={`mt-3 flex items-start gap-2 text-sm ${isAdmin ? '' : 'opacity-60'}`}
          data-testid="credit-sale-override-label"
        >
          <input
            type="checkbox"
            className="mt-0.5"
            data-testid="credit-sale-override-toggle"
            disabled={!isAdmin}
            {...form.register('creditOverride')}
          />
          <span className="flex flex-col">
            <span className="font-medium">
              {t('credit.override.label')}
            </span>
            <span className="text-xs text-secondary-500">
              {isAdmin
                ? t('credit.override.adminHelp')
                : t('credit.override.adminOnly')}
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
