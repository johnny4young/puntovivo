import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { isPaceHudEnabled, setPaceHudEnabled, subscribeToPaceHud } from './paceHudPreference';

/**
 * ENG-204 — per-user opt-in toggle for the cashier pace HUD. Sits next to
 * the sound toggle in the POS header (same self-contained pattern); the
 * shared preference store keeps the checkout-panel strip in lockstep.
 */
export function PaceToggleButton() {
  const { t } = useTranslation('sales');
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const ownerKey = currentTenant && user ? `${currentTenant.id}:${user.id}` : null;

  const enabled = useSyncExternalStore(
    subscribeToPaceHud,
    () => isPaceHudEnabled(ownerKey),
    () => false
  );

  const label = enabled ? t('paceHud.disable') : t('paceHud.enable');

  return (
    <button
      type="button"
      className="btn-outline flex items-center justify-center gap-2 whitespace-nowrap sm:flex-none"
      aria-label={label}
      title={label}
      aria-pressed={enabled}
      data-testid="sales-pace-toggle"
      onClick={() => setPaceHudEnabled(ownerKey, !enabled)}
    >
      <Gauge className={`h-4 w-4 ${enabled ? '' : 'opacity-50'}`} aria-hidden="true" />
    </button>
  );
}
