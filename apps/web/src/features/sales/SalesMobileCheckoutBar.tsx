import { useLayoutEffect, useRef } from 'react';
import { ListTree, PauseCircle, WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import { ariaKeyshortcutsFor } from '@/lib/shortcuts';
import type { SaleCartSummary } from '@/features/sales/saleCart';
import type { CashSession } from '@/types';
import type { ReceivableHandoff } from './handoff/useShiftHandoff';
import { SalesCreditKey } from './SalesCreditKey';

// explicit `| undefined` on optional fields.
interface SalesMobileCheckoutBarProps {
  draftSummary: SaleCartSummary;
  cashSession: CashSession | null;
  canCharge: boolean;
  canOpenCashSession: boolean;
  onCharge: () => void;
  onOpenCashSession: () => void;
  /** A register handed over for the selected one replaces opening it. */
  receiveHandoff?: ReceivableHandoff | null | undefined;
  canSuspend?: boolean | undefined;
  onSuspend?: (() => void) | undefined;
  /** Opens the charge drawer on credit; absent while the ticket cannot be charged. */
  onCredit?: (() => void) | undefined;
  /** What the customer would owe after this ticket; null while unknown. */
  creditProjectedBalance?: number | null | undefined;
  creditLimit?: number | undefined;
  creditActive?: boolean | undefined;
  suspendedDraftsCount?: number | undefined;
  /** Omitted when the register does not park sales and none are waiting. */
  onToggleSuspendedPanel?: (() => void) | undefined;
  /** Register zones: a key whose zone is off is not rendered. */
  showsSuspend?: boolean | undefined;
  showsCredit?: boolean | undefined;
  /**
   * same hub-reachability gate as `SalesCheckoutPanel`. The
   * mobile bar mirrors the desktop panel's behavior so a `hub_client`
   * terminal on a phone or tablet cannot bypass the gate by routing
   * checkout through the mobile-width primary action.
   */
  hubReachable?: boolean | undefined;
}

const PARK_GRID_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
};

/** Below `lg` the total, Cobrar and the park keys stay pinned to the bottom edge. */
export function SalesMobileCheckoutBar({
  draftSummary,
  cashSession,
  canCharge,
  canOpenCashSession,
  onCharge,
  onOpenCashSession,
  receiveHandoff = null,
  canSuspend = false,
  onSuspend,
  onCredit,
  creditProjectedBalance = null,
  creditLimit = 0,
  creditActive = false,
  suspendedDraftsCount = 0,
  onToggleSuspendedPanel,
  showsSuspend = true,
  showsCredit = true,
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
  const showsSuspended = Boolean(onToggleSuspendedPanel);
  const parkKeyCount = [showsSuspend, showsCredit, showsSuspended].filter(Boolean).length;

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
          ) : receiveHandoff?.isSelectedRegister ? (
            <Button
              type="button"
              className="sales-phone-charge w-full text-base"
              onClick={receiveHandoff.open}
              disabled={isHubGated}
              data-testid="mobile-checkout-primary"
            >
              <WalletCards className="h-5 w-5" aria-hidden="true" />
              {t('cashSession.receiveAction', { register: receiveHandoff.registerName })}
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
          {parkKeyCount > 0 && (
            <div
              className={`mt-2 grid gap-2 ${PARK_GRID_COLUMNS[parkKeyCount]}`}
              data-testid="mobile-park-controls"
            >
              {showsSuspend && (
                <button
                  type="button"
                  className="sales-secondary-key sales-phone-key"
                  onClick={onSuspend}
                  disabled={!canSuspendNow}
                  data-testid="mobile-checkout-suspend"
                  aria-keyshortcuts={
                    canSuspendNow ? ariaKeyshortcutsFor('sales.suspend') : undefined
                  }
                >
                  <PauseCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t('sell.actions.suspend')}
                </button>
              )}
              {showsCredit && (
                <SalesCreditKey
                  className="sales-secondary-key sales-phone-key sales-credit-key"
                  onClick={onCredit}
                  disabled={!canCredit}
                  projectedBalance={creditProjectedBalance}
                  creditLimit={creditLimit}
                  active={creditActive}
                  compact
                  testId="mobile-checkout-credit"
                />
              )}
              {showsSuspended && (
                <button
                  type="button"
                  className="sales-secondary-key sales-phone-key"
                  onClick={onToggleSuspendedPanel}
                  data-testid="mobile-checkout-open-suspended-panel"
                  aria-keyshortcuts={
                    suspendedDraftsCount > 0
                      ? ariaKeyshortcutsFor('sales.toggleSuspended')
                      : undefined
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
