import { SaleCartTable } from '@/features/sales/SaleCartTable';
import type { SaleCartItem } from '@/features/sales/saleCart';

interface SalesCartWorkspaceProps {
  items: SaleCartItem[];
  selectedItemKey: string | null;
  itemCount: number;
  saleError: string | null;
  onQuantityChange: (itemKey: string, quantity: number) => void;
  onDiscountChange: (itemKey: string, discount: number) => void;
  onRemove: (itemKey: string) => void;
  onSelectItem: (itemKey: string | null) => void;
  onClearCart: () => void;
  quantityInputRefFor: (itemKey: string) => (node: HTMLInputElement | null) => void;
  discountInputRefFor: (itemKey: string) => (node: HTMLInputElement | null) => void;
}

export function SalesCartWorkspace({
  items,
  selectedItemKey,
  itemCount,
  saleError,
  onQuantityChange,
  onDiscountChange,
  onRemove,
  onSelectItem,
  onClearCart,
  quantityInputRefFor,
  discountInputRefFor,
}: SalesCartWorkspaceProps) {
  return (
    <div className="card p-5 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="page-kicker text-[0.62rem] tracking-[0.24em]">Active ticket</p>
          <h2 className="mt-2 font-display text-3xl text-secondary-950">Current cart</h2>
          <p className="mt-2 max-w-2xl text-sm text-secondary-600">
            Adjust quantities, discounts, and tax-inclusive totals before sending the sale to
            payment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge badge-secondary">{itemCount} line items</span>
          <button className="btn-ghost" onClick={onClearCart} disabled={items.length === 0}>
            Clear cart
          </button>
        </div>
      </div>

      <SaleCartTable
        items={items}
        selectedItemKey={selectedItemKey}
        onQuantityChange={onQuantityChange}
        onDiscountChange={onDiscountChange}
        onRemove={onRemove}
        onSelectItem={itemKey => onSelectItem(itemKey)}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
      />

      {saleError && (
        <div className="mt-4 rounded-[20px] border border-danger-200/70 bg-danger-50/90 px-4 py-3 text-sm text-danger-700">
          {saleError}
        </div>
      )}
    </div>
  );
}
