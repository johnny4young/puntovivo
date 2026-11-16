/** Credit state of the payment sheet: who owes, how much, and what this sale adds. */
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';

import { roundMoney } from '@/lib/money';
import { cn, formatCurrency } from '@/lib/utils';
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
  /** The balance read failed: the projection is unknowable and checkout stays blocked. */
  balanceUnavailable?: boolean | undefined;
  /** Retry the balance read. Required with `balanceUnavailable`. */
  retryBalance?: (() => void) | undefined;
  /** Cash paid now on a single-tender credit sale. */
  creditDownPayment?: number | undefined;
}

const CAP_CLASS = 'text-xs font-semibold uppercase tracking-[0.1em] text-fg3';
const ROW_CLASS =
  'flex min-h-11 items-center justify-between gap-3 border-b-[1.5px] border-line text-[0.95rem] text-fg2';

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
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
  creditDownPayment = 0,
}: SaleCreditCustomerCardProps) {
  const { t } = useTranslation('sales');
  const customerName = selectedCustomer?.name ?? t('credit.card.unknownCustomer');
  const balanceKnown = !balanceLoading && !balanceUnavailable;
  const financed = splitMode
    ? creditAmountInSplit
    : roundMoney(Math.max(0, grandTotal - creditDownPayment));
  // An em dash on failure and an ellipsis while loading, never a made-up zero.
  const money = (amount: number) =>
    balanceUnavailable ? '—' : balanceLoading ? '…' : formatCurrency(amount);
  const owedShare =
    creditLimit > 0 ? Math.min(100, (Math.max(0, currentBalance) / creditLimit) * 100) : 0;
  const saleShare = creditLimit > 0 ? Math.min(100 - owedShare, (financed / creditLimit) * 100) : 0;

  return (
    <div data-testid="credit-sale-customer-card" aria-busy={balanceLoading} className="space-y-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="font-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning-500 text-sm text-ink"
        >
          {initialsOf(customerName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display truncate text-xl leading-tight text-foreground">
            {customerName}
          </p>
          {selectedCustomer?.taxId && (
            <p className="truncate text-sm text-fg3">{selectedCustomer.taxId}</p>
          )}
        </div>
      </div>

      {balanceUnavailable && (
        <div
          className="rounded-[13px] border-[1.5px] border-danger-500 bg-danger-50 p-3"
          role="alert"
          data-testid="credit-balance-error"
        >
          <p className="text-sm font-semibold text-danger-700">
            {t('credit.card.balanceUnavailable')}
          </p>
          <p className="mt-0.5 text-sm text-danger-700">
            {t('credit.card.balanceUnavailableHelp')}
          </p>
          {retryBalance && (
            <button
              type="button"
              className="btn-outline mt-2 min-h-11 px-3 text-sm"
              onClick={retryBalance}
              data-testid="credit-balance-retry"
            >
              {t('credit.card.balanceRetry')}
            </button>
          )}
        </div>
      )}

      {splitMode && creditAmountInSplit > 0 && (
        <p className="text-sm text-fg2" data-testid="credit-sale-partial-summary">
          {t('payment.partialCredit.summary', {
            cashAmount: formatCurrency(grandTotal - creditAmountInSplit),
            creditAmount: formatCurrency(creditAmountInSplit),
          })}
        </p>
      )}

      {creditLimit > 0 && balanceKnown && (
        <div>
          <div
            className="flex h-3.5 overflow-hidden rounded-full bg-surface-3"
            role="img"
            aria-label={t('credit.card.barLabel', {
              owed: formatCurrency(currentBalance),
              sale: formatCurrency(financed),
              limit: formatCurrency(creditLimit),
            })}
            data-testid="credit-sale-bar"
          >
            <span className="h-full bg-primary-700" style={{ width: `${owedShare}%` }} />
            <span
              className={cn('h-full', cupoExceeded ? 'bg-danger-500' : 'bg-cobrar')}
              style={{ width: `${saleShare}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between gap-2 text-xs text-fg3" aria-hidden="true">
            <span>{t('credit.card.owedToday')}</span>
            <span>{t('credit.card.plusThisSale')}</span>
          </div>
        </div>
      )}

      <dl>
        <div className={ROW_CLASS} data-testid="credit-sale-current-balance">
          <dt>{t('credit.card.balance')}</dt>
          <dd className="font-numeric text-xl text-foreground">{money(currentBalance)}</dd>
        </div>
        <div className={ROW_CLASS}>
          <dt>{t('credit.card.thisSale')}</dt>
          <dd className="font-numeric text-xl text-foreground" data-testid="credit-sale-this-sale">
            {formatCurrency(splitMode ? creditAmountInSplit : grandTotal)}
          </dd>
        </div>
        <div className={ROW_CLASS} data-testid="credit-sale-projected">
          <dt>{t('credit.card.projected')}</dt>
          <dd
            className={cn(
              'font-numeric text-xl',
              cupoExceeded ? 'text-danger-700' : 'text-foreground'
            )}
          >
            {money(projectedBalance)}
          </dd>
        </div>
        <div className={ROW_CLASS} data-testid="credit-sale-cupo">
          <dt>{t('credit.card.cupo')}</dt>
          <dd className="font-numeric text-xl text-foreground">
            {creditLimit > 0 ? formatCurrency(creditLimit) : t('credit.card.unlimited')}
          </dd>
        </div>
      </dl>

      {!splitMode && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="sale-credit-down-payment" className={cn(CAP_CLASS, 'mb-1.5 block')}>
              {t('credit.card.downPayment')}
            </label>
            <input
              id="sale-credit-down-payment"
              type="number"
              inputMode="decimal"
              min={0}
              max={grandTotal}
              step="0.01"
              className="font-numeric h-[52px] w-full rounded-[13px] border-[1.5px] border-line-strong bg-background px-3.5 text-xl text-foreground outline-none focus-visible:border-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              data-testid="credit-sale-down-payment"
              {...form.register('creditDownPayment', {
                setValueAs: value => {
                  const parsed = Number(value);
                  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
                },
              })}
            />
          </div>
          <div>
            <p className={cn(CAP_CLASS, 'mb-1.5')}>{t('credit.card.onCredit')}</p>
            <output
              htmlFor="sale-credit-down-payment"
              className="font-numeric flex h-[52px] items-center rounded-[13px] border-[1.5px] border-primary-600 bg-accent px-3.5 text-xl text-foreground"
              data-testid="credit-sale-on-credit"
            >
              {formatCurrency(financed)}
            </output>
          </div>
        </div>
      )}

      {cupoExceeded ? (
        <p
          className="flex items-start gap-2 text-sm text-warning-700"
          data-testid="credit-sale-warning"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('credit.warning.exceedsLimit')}
        </p>
      ) : (
        creditLimit > 0 && (
          <p className="flex items-start gap-2 text-sm text-fg2" data-testid="credit-sale-rule">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-700" aria-hidden="true" />
            {t('credit.card.cupoRule')}
          </p>
        )
      )}
      {/* Admins opt in here; other roles get the payload-bound request panel below. */}
      {cupoExceeded && isAdmin && (
        <label
          className="flex min-h-11 items-start gap-2 text-sm"
          data-testid="credit-sale-override-label"
        >
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0"
            data-testid="credit-sale-override-toggle"
            {...form.register('creditOverride')}
          />
          <span className="flex flex-col">
            <span className="font-semibold text-foreground">{t('credit.override.label')}</span>
            <span className="text-fg2">{t('credit.override.adminHelp')}</span>
          </span>
        </label>
      )}
      {cupoExceeded && !isAdmin && (
        <p className="text-sm text-fg2">{t('credit.override.approvalRequired')}</p>
      )}
    </div>
  );
}
