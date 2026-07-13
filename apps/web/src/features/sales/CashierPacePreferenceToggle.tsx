import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCashierPacePreference } from './useCashierPacePreference';

interface CashierPacePreferenceToggleProps {
  ownerKey: string;
}

/** Profile-menu opt-in. Metrics remain private to this owner key. */
export function CashierPacePreferenceToggle({ ownerKey }: CashierPacePreferenceToggleProps) {
  const { t } = useTranslation('common');
  const { enabled, setEnabled } = useCashierPacePreference(ownerKey);

  return (
    <button
      type="button"
      className="btn-ghost mt-2 w-full justify-start px-3"
      aria-pressed={enabled}
      data-testid="cashier-pace-preference-toggle"
      onClick={() => setEnabled(!enabled)}
    >
      <Gauge className="h-4 w-4" aria-hidden="true" />
      <span className="flex-1 text-left">{t('userMenu.cashierPace.preference')}</span>
      <span className="text-xs font-semibold text-fg2">
        {t(enabled ? 'userMenu.cashierPace.on' : 'userMenu.cashierPace.off')}
      </span>
    </button>
  );
}
