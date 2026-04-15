import { Receipt, Search, WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/utils';
import type { SaleCartSummary } from '@/features/sales/saleCart';
import type { CashSession } from '@/types';

interface SalesMobileCheckoutBarProps {
  draftSummary: SaleCartSummary;
  cashSession: CashSession | null;
  canCharge: boolean;
  canOpenCashSession: boolean;
  onOpenSearch: () => void;
  onCharge: () => void;
  onOpenCashSession: () => void;
}

export function SalesMobileCheckoutBar({
  draftSummary,
  cashSession,
  canCharge,
  canOpenCashSession,
  onOpenSearch,
  onCharge,
  onOpenCashSession,
}: SalesMobileCheckoutBarProps) {
  const { t } = useTranslation('sales');
  const primaryAction = cashSession ? onCharge : onOpenCashSession;
  const primaryActionLabel = cashSession ? t('checkout.chargeSale') : t('cashSession.openAction');
  const primaryActionDisabled = cashSession ? !canCharge : !canOpenCashSession;

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
            {cashSession ? <Receipt className="h-4 w-4" /> : <WalletCards className="h-4 w-4" />}
            {primaryActionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
