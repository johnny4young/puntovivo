import { Receipt, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/utils';
import type { SaleCartSummary } from '@/features/sales/saleCart';

interface SalesMobileCheckoutBarProps {
  draftSummary: SaleCartSummary;
  canCharge: boolean;
  onOpenSearch: () => void;
  onCharge: () => void;
}

export function SalesMobileCheckoutBar({
  draftSummary,
  canCharge,
  onOpenSearch,
  onCharge,
}: SalesMobileCheckoutBarProps) {
  const { t } = useTranslation('sales');
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
                {draftSummary.itemCount} item{draftSummary.itemCount === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <button type="button" className="btn-outline" onClick={onOpenSearch}>
            <Search className="h-4 w-4" />
            Search
          </button>
          <button type="button" className="btn-primary" onClick={onCharge} disabled={!canCharge}>
            <Receipt className="h-4 w-4" />
            Charge
          </button>
        </div>
      </div>
    </div>
  );
}
