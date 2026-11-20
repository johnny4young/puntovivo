import { Delete } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CASH_KEYPAD_KEYS, type CashKeypadKey } from './cashTender';

interface CashKeypadProps {
  onKey: (key: CashKeypadKey) => void;
  disabled?: boolean | undefined;
}

/**
 * Touch keypad for the received amount. Keys stay out of the tab order: a
 * keyboard cashier types in the field itself.
 */
export function CashKeypad({ onKey, disabled = false }: CashKeypadProps) {
  const { t } = useTranslation('sales');

  return (
    <div
      className="sale-pay-keypad"
      role="group"
      aria-label={t('payment.keypad.label')}
      data-testid="sale-payment-keypad"
    >
      {CASH_KEYPAD_KEYS.map(key => (
        <button
          key={key}
          type="button"
          tabIndex={-1}
          className="sale-pay-key"
          disabled={disabled}
          aria-label={key === 'back' ? t('payment.keypad.back') : undefined}
          onClick={() => onKey(key)}
          data-testid={`sale-payment-key-${key}`}
        >
          {key === 'back' ? <Delete className="h-6 w-6" aria-hidden="true" /> : key}
        </button>
      ))}
    </div>
  );
}
