import { useContext } from 'react';
import { isOnAccountVerticalId } from '@puntovivo/shared/vertical-presets';
import { CircleAlert, HandCoins } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AuthContext } from '@/features/auth/AuthContext';
import { formatCurrency } from '@/lib/utils';

interface SalesCreditKeyProps {
  className: string;
  onClick?: (() => void) | undefined;
  disabled: boolean;
  /** What the customer would owe after this ticket; null while unknown or without a customer. */
  projectedBalance: number | null;
  creditLimit: number;
  /** The ticket is already set to go on the account. */
  active?: boolean | undefined;
  /** Narrow keys show only the amount; the sentence stays for assistive technology. */
  compact?: boolean | undefined;
  testId: string;
}

/** Fiar (or A crédito) beside Cobrar, with what the account would come to. */
export function SalesCreditKey({
  className,
  onClick,
  disabled,
  projectedBalance,
  creditLimit,
  active = false,
  compact = false,
  testId,
}: SalesCreditKeyProps) {
  const { t } = useTranslation('sales');
  const businessType = useContext(AuthContext)?.tenant?.settings?.businessType;
  const onAccount = isOnAccountVerticalId(businessType);
  const overLimit = projectedBalance !== null && creditLimit > 0 && projectedBalance > creditLimit;
  const projection =
    projectedBalance === null
      ? null
      : t(onAccount ? 'sell.credit.owesAfter' : 'sell.credit.wouldOwe', {
          amount: formatCurrency(projectedBalance),
        });

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      data-active={active || undefined}
      data-testid={testId}
    >
      <span className="sales-credit-key-label">
        <HandCoins className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t(onAccount ? 'sell.actions.onAccount' : 'sell.actions.credit')}
      </span>
      {projectedBalance !== null && (
        <small
          className="sales-credit-key-projection"
          data-over={overLimit || undefined}
          data-testid={`${testId}-projection`}
        >
          {overLimit && <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {compact ? (
            <>
              <span aria-hidden="true">{formatCurrency(projectedBalance)}</span>
              <span className="sr-only">{projection}</span>
            </>
          ) : (
            projection
          )}
          {overLimit && <span className="sr-only"> · {t('sell.credit.overLimit')}</span>}
        </small>
      )}
    </button>
  );
}
