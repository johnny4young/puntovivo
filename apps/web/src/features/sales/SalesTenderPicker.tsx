import { ArrowLeftRight, Banknote, CreditCard, LayoutGrid, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cashChange, suggestCashTenders } from '@/features/sales/cashTender';
import { useRegisterZone } from '@/features/modules/useRegisterZone';
import type { InitialTender } from '@/features/sales/salePaymentModal.types';
import { ariaKeyshortcutsFor, shortcutDisplayFor } from '@/lib/shortcuts';
import { formatCurrency } from '@/lib/utils';

const TENDERS = [
  { tender: 'cash', labelKey: 'payment.cash', icon: Banknote },
  { tender: 'card', labelKey: 'payment.card', icon: CreditCard },
  { tender: 'transfer', labelKey: 'payment.transfer', icon: ArrowLeftRight },
  { tender: 'credit', labelKey: 'payment.credit', icon: UserRound },
  { tender: 'split', labelKey: 'sell.tender.split', icon: LayoutGrid },
] as const satisfies ReadonlyArray<{ tender: InitialTender; labelKey: string; icon: unknown }>;
const TENDERS_WITHOUT_CREDIT = TENDERS.filter(({ tender }) => tender !== 'credit');

interface SalesTenderPickerProps {
  tender: InitialTender;
  onTenderChange: (tender: InitialTender) => void;
  /** What a cash customer owes right now; the one-touch tiles price against it. */
  cashDue: number;
  /** Omitted while the sale cannot be charged: the one-touch cash row hides. */
  onFastCash?: ((tendered?: number | null) => void) | undefined;
}

/** The tender picked before charging, and the one-touch cash keys. */
export function SalesTenderPicker({
  tender,
  onTenderChange,
  cashDue,
  onFastCash,
}: SalesTenderPickerProps) {
  const { t } = useTranslation('sales');
  const sellsOnCredit = useRegisterZone('credit');
  const tenders = sellsOnCredit ? TENDERS : TENDERS_WITHOUT_CREDIT;
  const showCashKeys = tender === 'cash' && !!onFastCash && cashDue > 0;

  return (
    <div className="space-y-3" data-testid="sales-tender-picker">
      <div role="group" aria-labelledby="sales-tender-title">
        <p id="sales-tender-title" className="sales-cap mb-1.5">
          {t('sell.tender.title')}
        </p>
        <div className="flex gap-1.5">
          {tenders.map(({ tender: option, labelKey, icon: Icon }) => (
            <button
              key={option}
              type="button"
              className="sales-tender-tile"
              aria-pressed={option === tender}
              onClick={() => onTenderChange(option)}
              data-testid={`sales-tender-${option}`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </div>

      {showCashKeys && (
        <div role="group" aria-labelledby="sales-cash-title" data-testid="sales-cash-keys">
          <p id="sales-cash-title" className="sales-cap mb-1.5">
            {t('sell.cash.title')}
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              className="sales-cash-key sales-cash-key-exact"
              onClick={() => onFastCash()}
              aria-keyshortcuts={ariaKeyshortcutsFor('sales.fastCash')}
              data-testid="checkout-fast-cash"
            >
              <small>
                {t('sell.cash.exact')}{' '}
                <kbd className="pv-kbd" aria-hidden="true">
                  {shortcutDisplayFor('sales.fastCash')}
                </kbd>
              </small>
              <b>{formatCurrency(cashDue)}</b>
            </button>
            {suggestCashTenders(cashDue).map(amount => (
              <button
                key={amount}
                type="button"
                className="sales-cash-key"
                onClick={() => onFastCash(amount)}
                data-testid={`sales-cash-key-${amount}`}
              >
                <small>
                  <span className="sales-cash-verb">{t('sell.cash.receives')} </span>
                  {formatCurrency(amount)}
                </small>
                <b>
                  {t('sell.cash.change', { amount: formatCurrency(cashChange(amount, cashDue)) })}
                </b>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
