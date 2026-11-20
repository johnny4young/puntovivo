import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/utils';
import { changeBreakdown } from './cashDenominations';

interface CashChangeHeroProps {
  change: number;
  /** Positive while the cash received does not cover the sale. */
  outstanding: number;
  currencyCode: string;
}

/** The change to hand back, as the largest figure of the cash charge, and one way to give it. */
export function CashChangeHero({ change, outstanding, currencyCode }: CashChangeHeroProps) {
  const { t } = useTranslation('sales');
  const short = outstanding > 0;
  const breakdown = short ? null : changeBreakdown(change, currencyCode);

  return (
    <section
      className="sale-pay-change"
      data-short={short || undefined}
      aria-labelledby="sale-payment-change-title"
      data-testid="payment-settlement"
    >
      <h3 id="sale-payment-change-title" className="sales-cap sale-pay-change-title">
        {short ? t('payment.balance') : t('payment.changeDue')}
      </h3>
      <p className="sale-pay-change-figure" data-testid="payment-settlement-amount">
        {formatCurrency(short ? outstanding : change)}
      </p>
      {breakdown && (
        <div className="sale-pay-change-ways" data-testid="payment-change-breakdown">
          <span>{t('payment.changeWay')}</span>
          <ul className="sale-pay-change-list">
            {breakdown.bills.map(({ value, count }) => (
              <li key={value} className="sale-pay-change-chip">
                {t('payment.changeBill', { quantity: count, amount: formatCurrency(value) })}
              </li>
            ))}
            {breakdown.coins > 0 && (
              <li className="sale-pay-change-chip">
                {t('payment.changeCoins', { amount: formatCurrency(breakdown.coins) })}
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}
