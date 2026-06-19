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
}: SaleCreditCustomerCardProps) {
  const { t } = useTranslation('sales');

  return (
    <div
      className="rounded-xl border border-secondary-200 p-4"
      data-testid="credit-sale-customer-card"
    >
      <p className="text-sm font-medium text-secondary-900">
        {selectedCustomer?.name ?? t('credit.card.unknownCustomer')}
      </p>
      {selectedCustomer?.taxId && (
        <p className="text-xs text-secondary-500">
          {selectedCustomer.taxId}
        </p>
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
          className={`rounded border p-2 ${currentBalance > 0 ? 'border-danger-300 bg-danger-50 text-danger-700' : 'border-line bg-white text-secondary-900'}`}
          data-testid="credit-sale-current-balance"
        >
          <p className="text-xs uppercase tracking-wide text-secondary-500">
            {t('credit.card.balance')}
          </p>
          <p className="mt-1 text-base font-medium tabular-nums">
            {balanceLoading
              ? '…'
              : formatCurrency(currentBalance)}
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
            {formatCurrency(projectedBalance)}
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
