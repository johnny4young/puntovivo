import { Plus } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { Site } from '@/types';
import type { OrderCartSummary } from '@/features/orders/orderCart';

interface OrdersCheckoutPanelProps {
  currentSite: Site | null;
  draftSummary: OrderCartSummary;
  canFinalize: boolean;
  onOpenSearch: () => void;
  onFinalize: () => void;
}

export function OrdersCheckoutPanel({
  currentSite,
  draftSummary,
  canFinalize,
  onOpenSearch,
  onFinalize,
}: OrdersCheckoutPanelProps) {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-secondary-900">Finalize</h2>
          <p className="text-sm text-secondary-500">Review provider, site, and committed total before saving</p>
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
            <span className="text-secondary-500">Base units requested</span>
            <span className="font-medium text-secondary-900">{draftSummary.normalizedUnits}</span>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-secondary-200 pt-4">
            <span className="text-base font-medium text-secondary-900">Total</span>
            <span className="text-2xl font-semibold text-primary-700">
              {formatCurrency(draftSummary.total)}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-secondary-200 px-4 py-4 text-sm">
          <p className="text-secondary-500">Requesting site</p>
          <p className="mt-1 font-medium text-secondary-900">{currentSite?.name ?? 'No site selected'}</p>
        </div>

        <div className="rounded-xl border border-dashed border-secondary-300 bg-secondary-50 px-4 py-4 text-sm text-secondary-600">
          Purchase orders reserve the document number and provider request details, but they do not
          update stock until an actual purchase is registered.
        </div>

        <button className="btn-primary w-full" onClick={onFinalize} disabled={!canFinalize}>
          Create Purchase Order
        </button>
      </div>
    </div>
  );
}
