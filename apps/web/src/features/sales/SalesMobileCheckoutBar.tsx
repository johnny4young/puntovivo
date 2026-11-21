import { useLayoutEffect, useRef } from 'react';
import { HandCoins, ListTree, PauseCircle, WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import { ariaKeyshortcutsFor } from '@/lib/shortcuts';
import type { SaleCartSummary } from '@/features/sales/saleCart';
import type { CashSession } from '@/types';

// explicit `| undefined` on optional fields.
interface SalesMobileCheckoutBarProps {
  draftSummary: SaleCartSummary;
  cashSession: CashSession | null;
  canCharge: boolean;
  canOpenCashSession: boolean;
  onCharge: () => void;
  onOpenCashSession: () => void;
  canSuspend?: boolean | undefined;
  onSuspend?: (() => void) | undefined;
  /** Opens the charge drawer on credit; absent while the ticket cannot be charged. */
  onCredit?: (() => void) | undefined;
  suspendedDraftsCount?: number | undefined;
  onToggleSuspendedPanel?: (() => void) | undefined;
  /**
   * same hub-reachability gate as `SalesCheckoutPanel`. The
   * mobile bar mirrors the desktop panel's behavior so a `hub_client`
   * terminal on a phone or tablet cannot bypass the gate by routing
   * checkout through the mobile-width primary action.
   */
  hubReachable?: boolean | undefined;
}

/** Below `lg` the total, Cobrar and the park keys stay pinned to the bottom edge. */
export function SalesMobileCheckoutBar({
  draftSummary,
  cashSession,
  canCharge,
  canOpenCashSession,
  onCharge,
  onOpenCashSession,
  canSuspend = false,
  onSuspend,
  onCredit,
  suspendedDraftsCount = 0,
  onToggleSuspendedPanel,
  hubReachable,
}: SalesMobileCheckoutBarProps) {
  const { t } = useTranslation('sales');
  const barRef = useRef<HTMLDivElement>(null);
  const footprintRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const footprint = footprintRef.current;
    if (!bar || !footprint) return;
    // The fixed bar can grow with translations, park actions and text zoom.
    // Reserve its actual layout height so the last checkout controls can scroll clear.
    // The observer's first callback runs before paint; reading here would force layout in the commit.
    const observer = new ResizeObserver(() => {
      footprint.style.height = `${bar.offsetHeight}px`;
    });
    observer.observe(bar, { box: 'border-box' });
    return () => observer.disconnect();
  }, []);
  // mirror the SalesCheckoutPanel gate so a hub_client
  // terminal on a phone or tablet cannot bypass the hub-unreachable
  // state by triggering checkout from the mobile bar.
  const isHubGated = hubReachable === false;
  const canSuspendNow = Boolean(onSuspend && canSuspend);
  const canCredit = Boolean(onCredit) && !isHubGated;

  return (
    <div ref={footprintRef} className="lg:hidden" data-testid="mobile-checkout-footprint">
      <div ref={barRef} data-testid="mobile-checkout-bar" className="sales-phone-bar">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <p className="sales-cap pb-1" data-testid="mobile-checkout-caption">
              {t('sell.phone.total', { count: draftSummary.itemCount })}
            </p>
            <p className="sales-phone-total" data-testid="mobile-checkout-total">
              {formatCurrency(draftSummary.total)}
            </p>
          </div>
          {cashSession ? (
            <Button
              type="button"
              variant="charge"
              className="sales-charge-key sales-phone-charge"
              onClick={onCharge}
              disabled={isHubGated || !canCharge}
              aria-keyshortcuts={ariaKeyshortcutsFor('sales.charge')}
              data-testid="mobile-checkout-primary"
            >
              {t('checkout.chargeSale')}
            </Button>
          ) : (
            <Button
              type="button"
              className="sales-phone-charge w-full text-base"
              onClick={onOpenCashSession}
              disabled={isHubGated || !canOpenCashSession}
              aria-keyshortcuts={ariaKeyshortcutsFor('sales.openCashSession')}
              data-testid="mobile-checkout-primary"
            >
              <WalletCards className="h-5 w-5" aria-hidden="true" />
              {t('cashSession.openAction')}
            </Button>
          )}
          <div className="mt-2 grid grid-cols-3 gap-2" data-testid="mobile-park-controls">
            <button
              type="button"
              className="sales-secondary-key sales-phone-key"
              onClick={onSuspend}
              disabled={!canSuspendNow}
              data-testid="mobile-checkout-suspend"
              aria-keyshortcuts={canSuspendNow ? ariaKeyshortcutsFor('sales.suspend') : undefined}
            >
              <PauseCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t('sell.actions.suspend')}
            </button>
            <button
              type="button"
              className="sales-secondary-key sales-phone-key"
              onClick={onCredit}
              disabled={!canCredit}
              data-testid="mobile-checkout-credit"
            >
              <HandCoins className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t('sell.actions.credit')}
            </button>
            <button
              type="button"
              className="sales-secondary-key sales-phone-key"
              onClick={onToggleSuspendedPanel}
              disabled={!onToggleSuspendedPanel}
              data-testid="mobile-checkout-open-suspended-panel"
              aria-keyshortcuts={
                suspendedDraftsCount > 0 ? ariaKeyshortcutsFor('sales.toggleSuspended') : undefined
              }
            >
              <ListTree className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t('sell.actions.suspended')}
              {suspendedDraftsCount > 0 && (
                <>
                  {' '}
                  <span className="sales-phone-count" data-testid="mobile-suspended-count">
                    {suspendedDraftsCount}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
