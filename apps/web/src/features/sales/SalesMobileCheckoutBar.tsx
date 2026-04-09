import { Receipt, Search } from 'lucide-react';
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
  return (
    <div className="xl:hidden">
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-secondary-200 bg-white/95 px-4 py-3 shadow-[0_-12px_30px_rgba(15,23,42,0.12)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">
              Draft total
            </p>
            <div className="flex items-end gap-2">
              <p className="truncate text-lg font-semibold text-secondary-900">
                {formatCurrency(draftSummary.total)}
              </p>
              <p className="pb-0.5 text-sm text-secondary-500">
                {draftSummary.itemCount} item{draftSummary.itemCount === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-outline flex items-center gap-2"
            onClick={onOpenSearch}
          >
            <Search className="h-4 w-4" />
            Search
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-2"
            onClick={onCharge}
            disabled={!canCharge}
          >
            <Receipt className="h-4 w-4" />
            Charge
          </button>
        </div>
      </div>
    </div>
  );
}
