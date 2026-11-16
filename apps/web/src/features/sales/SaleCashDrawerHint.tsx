import { useTranslation } from 'react-i18next';

import { useTenant } from '@/features/tenant/TenantProvider';
import { trpc } from '@/lib/trpc';

/**
 * Says the drawer will open only when it really will: the site's printer
 * prints on completion and kicks the drawer with the receipt.
 */
export function SaleCashDrawerHint() {
  const { t } = useTranslation('sales');
  const { currentSite } = useTenant();
  // Same key and freshness as the sales shell, so this never adds a request.
  const peripherals = trpc.peripherals.activeForSite.useQuery(
    { siteId: currentSite?.id ?? '' },
    { enabled: !!currentSite, staleTime: 5 * 60 * 1000 }
  );
  const printer = peripherals.data?.find(row => row.kind === 'printer');
  const config = (printer?.config ?? null) as Record<string, unknown> | null;
  if (config?.autoPrintOnComplete !== true || config.kickDrawerAfterReceipt !== true) return null;

  return (
    <p className="mt-1 text-sm text-fg2" data-testid="sale-cash-drawer-hint">
      {t('payment.drawerOpens')}
    </p>
  );
}
