import { useTranslation } from 'react-i18next';

import { formatCurrency } from '@/lib/utils';
import { cupoShare } from './cupoShare';
import { initialsOf } from './handoff/handoffModel';
import type { CustomerAccount } from './useCustomerAccount';

interface CustomerAccountBarProps {
  account: CustomerAccount;
  /** Shown where nothing above already names the customer (phone). */
  customerName?: string | null | undefined;
  /** Omitted when there is nothing to pay or no open register to take the cash. */
  onPay?: (() => void) | undefined;
}

/** What the ticket's customer owes against their cupo, with a way to pay it down. */
export function CustomerAccountBar({ account, customerName, onPay }: CustomerAccountBarProps) {
  const { t } = useTranslation('sales');
  const { balance, creditLimit } = account;
  const owedShare = cupoShare(balance, creditLimit);

  return (
    <section className="sales-account" data-testid="customer-account-bar">
      {customerName && (
        <div className="sales-account-name">
          <span className="sales-avatar sales-avatar-sm" aria-hidden="true">
            {initialsOf(customerName)}
          </span>
          <p className="truncate font-semibold text-fg1">{customerName}</p>
        </div>
      )}
      <div className="sales-account-row">
        {creditLimit > 0 && (
          <span
            className="sales-account-meter"
            data-over={balance > creditLimit || undefined}
            aria-hidden="true"
          >
            <span style={{ width: `${owedShare}%` }} />
          </span>
        )}
        <p className="sales-account-owed" data-testid="customer-account-owed">
          {balance < 0 ? (
            <>
              {t('sell.account.inFavor')} <b>{formatCurrency(-balance)}</b>
            </>
          ) : (
            <>
              {t('sell.account.owes')} <b>{formatCurrency(balance)}</b>
              {creditLimit > 0 && (
                <> {t('sell.account.ofLimit', { limit: formatCurrency(creditLimit) })}</>
              )}
            </>
          )}
        </p>
        {onPay && (
          <button
            type="button"
            className="btn-outline sales-account-pay"
            onClick={onPay}
            data-testid="customer-account-pay"
          >
            {t('sell.account.pay')}
          </button>
        )}
      </div>
    </section>
  );
}
