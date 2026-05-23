import {
  FilePlus2,
  ListTree,
  PauseCircle,
  Receipt,
  Search,
  WalletCards,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/utils';
import type { SaleCartSummary } from '@/features/sales/saleCart';
import type { CashSession } from '@/types';

interface SalesMobileCheckoutBarProps {
  draftSummary: SaleCartSummary;
  cashSession: CashSession | null;
  canCharge: boolean;
  canOpenCashSession: boolean;
  canCloseCashSession: boolean;
  onOpenSearch: () => void;
  onCharge: () => void;
  onOpenCashSession: () => void;
  onCloseCashSession: () => void;
  canSuspend?: boolean;
  onSuspend?: () => void;
  onNewSale?: () => void;
  suspendedDraftsCount?: number;
  onToggleSuspendedPanel?: () => void;
  /**
   * ENG-074 — same hub-reachability gate as `SalesCheckoutPanel`. The
   * mobile bar mirrors the desktop panel's behavior so a `hub_client`
   * terminal on a phone or tablet cannot bypass the gate by routing
   * checkout through the mobile-width primary action.
   */
  hubReachable?: boolean;
}

export function SalesMobileCheckoutBar({
  draftSummary,
  cashSession,
  canCharge,
  canOpenCashSession,
  canCloseCashSession,
  onOpenSearch,
  onCharge,
  onOpenCashSession,
  onCloseCashSession,
  canSuspend = false,
  onSuspend,
  onNewSale,
  suspendedDraftsCount = 0,
  onToggleSuspendedPanel,
  hubReachable,
}: SalesMobileCheckoutBarProps) {
  const { t } = useTranslation('sales');
  const hasDraftItems = draftSummary.itemCount > 0;
  // ENG-074 — mirror the SalesCheckoutPanel gate so a hub_client
  // terminal on a phone or tablet cannot bypass the hub-unreachable
  // state by triggering checkout from the mobile bar.
  const isHubGated = hubReachable === false;
  const primaryAction = cashSession
    ? hasDraftItems
      ? onCharge
      : onCloseCashSession
    : onOpenCashSession;
  const primaryActionLabel = cashSession
    ? hasDraftItems
      ? t('checkout.chargeSale')
      : t('cashSession.closeAction')
    : t('cashSession.openAction');
  const primaryActionDisabled = isHubGated
    ? true
    : cashSession
      ? hasDraftItems
        ? !canCharge
        : !canCloseCashSession
      : !canOpenCashSession;
  const showSuspendAction = Boolean(onSuspend && canSuspend);
  const showNewSaleAction = Boolean(onNewSale);
  const showParkActions = showSuspendAction || showNewSaleAction || Boolean(onToggleSuspendedPanel);

  return (
    <div className="xl:hidden">
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface/92 px-4 py-3 shadow-[0_-18px_40px_rgba(10,18,33,0.16)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
              {t('page.draftTotal')}
            </p>
            <div className="mt-1 flex items-end gap-2">
              <p className="truncate text-lg font-semibold text-secondary-950">
                {formatCurrency(draftSummary.total)}
              </p>
              <p className="pb-0.5 text-sm text-secondary-500">
                {t('checkout.lineItems', { count: draftSummary.itemCount })}
              </p>
            </div>
          </div>
          <button type="button" className="btn-outline" onClick={onOpenSearch}>
            <Search className="h-4 w-4" />
            {t('quickSearch.search')}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={primaryAction}
            disabled={primaryActionDisabled}
          >
            {cashSession && hasDraftItems ? (
              <Receipt className="h-4 w-4" />
            ) : (
              <WalletCards className="h-4 w-4" />
            )}
            {primaryActionLabel}
          </button>
        </div>
        {showParkActions && (
          <div
            className="mx-auto mt-3 grid max-w-7xl grid-cols-3 gap-2"
            data-testid="mobile-park-controls"
          >
            {showSuspendAction && (
              <button
                type="button"
                className="btn-outline justify-center px-2 text-xs"
                onClick={onSuspend}
                data-testid="mobile-checkout-suspend"
              >
                <PauseCircle className="h-4 w-4" />
                {t('park.suspend')}
              </button>
            )}
            {showNewSaleAction && (
              <button
                type="button"
                className="btn-outline justify-center px-2 text-xs"
                onClick={onNewSale}
                data-testid="mobile-checkout-new-sale"
              >
                <FilePlus2 className="h-4 w-4" />
                {t('park.newSale')}
              </button>
            )}
            {onToggleSuspendedPanel && (
              <button
                type="button"
                className="btn-outline justify-center px-2 text-xs"
                onClick={onToggleSuspendedPanel}
                data-testid="mobile-checkout-open-suspended-panel"
              >
                <ListTree className="h-4 w-4" />
                {t('park.panelTitle')}
                {suspendedDraftsCount > 0 && (
                  <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-[0.65rem] font-semibold text-primary-700">
                    {suspendedDraftsCount}
                  </span>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
