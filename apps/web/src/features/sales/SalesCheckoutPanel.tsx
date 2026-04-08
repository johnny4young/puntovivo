import { Plus } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { SaleCartSummary } from '@/features/sales/saleCart';
import type { Site } from '@/types';

interface SalesCheckoutPanelProps {
  currentSite: Site | null;
  draftSummary: SaleCartSummary;
  canCharge: boolean;
  onOpenSearch: () => void;
  onCharge: () => void;
}

export function SalesCheckoutPanel({
  currentSite,
  draftSummary,
  canCharge,
  onOpenSearch,
  onCharge,
}: SalesCheckoutPanelProps) {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-secondary-900">Checkout</h2>
          <p className="text-sm text-secondary-500">Review the VAT-inclusive sale totals before charging</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={onOpenSearch}>
          <Plus className="h-4 w-4" />
          Search
        </button>
      </div>

      <div className="mt-6 space-y-4">
        <div className="rounded-xl border border-secondary-200 px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="text-secondary-500">Items</span>
            <span className="font-medium text-secondary-900">{draftSummary.itemCount}</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-secondary-500">Subtotal</span>
            <span className="font-medium text-secondary-900">
              {formatCurrency(draftSummary.subtotal)}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-secondary-500">VAT</span>
            <span className="font-medium text-secondary-900">
              {formatCurrency(draftSummary.taxAmount)}
            </span>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-secondary-200 pt-4">
            <span className="text-base font-medium text-secondary-900">Total</span>
            <span className="text-2xl font-semibold text-primary-700">
              {formatCurrency(draftSummary.total)}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-secondary-300 bg-secondary-50 px-4 py-4 text-sm text-secondary-600">
          Product search uses the existing catalog dialog, including unit selection and site-aware stock validation at checkout.
        </div>

        <div className="rounded-xl border border-secondary-200 px-4 py-4 text-sm text-secondary-600">
          <p className="font-medium text-secondary-900">POS shortcuts</p>
          <p className="mt-2">`F5` search catalog, `F1` charge sale, `Delete` remove selected row.</p>
          <p className="mt-1">`Alt+P` focus search, `Alt+C` quantity, `Alt+D` discount, `Alt+U` unit in search.</p>
        </div>

        <div className="rounded-xl border border-secondary-200 px-4 py-4 text-sm">
          <p className="text-secondary-500">Charging site</p>
          <p className="mt-1 font-medium text-secondary-900">{currentSite?.name ?? 'No site selected'}</p>
        </div>

        <button className="btn-primary w-full" onClick={onCharge} disabled={!canCharge}>
          Charge Sale
        </button>
      </div>
    </div>
  );
}
