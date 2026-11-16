import { Delete } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '000'] as const;

interface SalePaymentKeypadProps {
  /** Receives the digits to append, or 'backspace'. */
  onKey: (key: string) => void;
}

/** On-screen keys for a touch till; a keyboard types straight into the field. */
export function SalePaymentKeypad({ onKey }: SalePaymentKeypadProps) {
  const { t } = useTranslation('sales');
  const keyClass =
    'font-numeric flex min-h-12 items-center justify-center rounded-[14px] bg-surface-3 text-2xl text-foreground transition-colors hover:bg-line active:bg-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  return (
    <div
      className="grid grid-cols-6 gap-2"
      role="group"
      aria-label={t('payment.keypad.label')}
      data-testid="sale-payment-keypad"
    >
      {KEYS.map(key => (
        <button
          key={key}
          type="button"
          className={keyClass}
          onClick={() => onKey(key)}
          data-testid={`sale-payment-key-${key}`}
        >
          {key}
        </button>
      ))}
      <button
        type="button"
        className={keyClass}
        onClick={() => onKey('backspace')}
        aria-label={t('payment.keypad.backspace')}
        data-testid="sale-payment-key-backspace"
      >
        <Delete className="h-6 w-6" aria-hidden="true" />
      </button>
    </div>
  );
}
