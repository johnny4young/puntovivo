import { Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { getLineTotals, type SaleCartItem } from '@/features/sales/saleCart';

interface SaleCartTableProps {
  items: SaleCartItem[];
  selectedItemKey: string | null;
  onQuantityChange: (itemKey: string, quantity: number) => void;
  onDiscountChange: (itemKey: string, discount: number) => void;
  onRemove: (itemKey: string) => void;
  onSelectItem: (itemKey: string) => void;
  quantityInputRefFor: (itemKey: string) => (node: HTMLInputElement | null) => void;
  discountInputRefFor: (itemKey: string) => (node: HTMLInputElement | null) => void;
}

export function SaleCartTable({
  items,
  selectedItemKey,
  onQuantityChange,
  onDiscountChange,
  onRemove,
  onSelectItem,
  quantityInputRefFor,
  discountInputRefFor,
}: SaleCartTableProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-secondary-300 bg-secondary-50 px-4 py-10 text-center text-sm text-secondary-500">
        Search and add products to start a sale.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="hidden overflow-hidden rounded-xl border border-secondary-200 lg:block">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-secondary-200">
            <thead className="bg-secondary-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Qty</th>
                <th className="px-4 py-3">Discount %</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Tax</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-200 bg-white">
              {items.map(item => {
                const lineTotals = getLineTotals(item);
                const isSelected = selectedItemKey === item.key;

                return (
                  <tr
                    key={item.key}
                    className={isSelected ? 'bg-primary-50' : undefined}
                    onClick={() => onSelectItem(item.key)}
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-secondary-900">{item.productName}</p>
                        <p className="text-xs text-secondary-500">
                          {item.productSku}
                          {' · '}
                          {item.unitName}
                          {' · '}
                          Stock {item.availableStock}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        ref={quantityInputRefFor(item.key)}
                        type="number"
                        min={1}
                        step={1}
                        className="input w-24"
                        aria-label={`Quantity for ${item.productName}`}
                        value={item.quantity}
                        onFocus={() => onSelectItem(item.key)}
                        onChange={event =>
                          onQuantityChange(item.key, Math.max(1, Number(event.target.value) || 1))
                        }
                      />
                      <p className="mt-1 text-xs text-secondary-500">
                        Base qty {lineTotals.normalizedQuantity}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        ref={discountInputRefFor(item.key)}
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        className="input w-24"
                        aria-label={`Discount for ${item.productName}`}
                        value={item.discount}
                        onFocus={() => onSelectItem(item.key)}
                        onChange={event =>
                          onDiscountChange(
                            item.key,
                            Math.min(100, Math.max(0, Number(event.target.value) || 0))
                          )
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-secondary-900">
                      {formatCurrency(item.unitPrice)}
                    </td>
                    <td className="px-4 py-3 text-sm text-secondary-600">
                      {formatCurrency(lineTotals.taxAmount)}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-secondary-900">
                      {formatCurrency(lineTotals.total)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
                        aria-label={`Remove ${item.productName}`}
                        onClick={event => {
                          event.stopPropagation();
                          onRemove(item.key);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ul className="grid gap-3 lg:hidden" aria-label="Cart items">
        {items.map(item => {
          const lineTotals = getLineTotals(item);
          const isSelected = selectedItemKey === item.key;

          return (
            <li
              key={`${item.key}-mobile`}
              className={`rounded-xl border p-4 shadow-sm transition ${
                isSelected
                  ? 'border-primary-300 bg-primary-50'
                  : 'border-secondary-200 bg-white'
              }`}
            >
              <button
                type="button"
                className="w-full text-left"
                aria-label={`Select ${item.productName}`}
                onClick={() => onSelectItem(item.key)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-secondary-900">{item.productName}</p>
                    <p className="mt-1 text-xs text-secondary-500">
                      {item.productSku}
                      {' · '}
                      {item.unitName}
                    </p>
                  </div>
                  <span className="rounded-full bg-secondary-100 px-2 py-1 text-xs font-medium text-secondary-700">
                    Stock {item.availableStock}
                  </span>
                </div>
              </button>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs font-medium uppercase tracking-wide text-secondary-500">
                  Quantity
                  <input
                    ref={quantityInputRefFor(item.key)}
                    type="number"
                    min={1}
                    step={1}
                    className="input mt-0"
                    aria-label={`Quantity for ${item.productName}`}
                    value={item.quantity}
                    onFocus={() => onSelectItem(item.key)}
                    onChange={event =>
                      onQuantityChange(item.key, Math.max(1, Number(event.target.value) || 1))
                    }
                  />
                </label>
                <label className="space-y-1 text-xs font-medium uppercase tracking-wide text-secondary-500">
                  Discount %
                  <input
                    ref={discountInputRefFor(item.key)}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="input mt-0"
                    aria-label={`Discount for ${item.productName}`}
                    value={item.discount}
                    onFocus={() => onSelectItem(item.key)}
                    onChange={event =>
                      onDiscountChange(
                        item.key,
                        Math.min(100, Math.max(0, Number(event.target.value) || 0))
                      )
                    }
                  />
                </label>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-secondary-50 px-3 py-3 text-sm">
                <div>
                  <p className="text-secondary-500">Price</p>
                  <p className="font-medium text-secondary-900">{formatCurrency(item.unitPrice)}</p>
                </div>
                <div>
                  <p className="text-secondary-500">Tax</p>
                  <p className="font-medium text-secondary-900">
                    {formatCurrency(lineTotals.taxAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-secondary-500">Base qty</p>
                  <p className="font-medium text-secondary-900">{lineTotals.normalizedQuantity}</p>
                </div>
                <div>
                  <p className="text-secondary-500">Line total</p>
                  <p className="font-semibold text-secondary-900">
                    {formatCurrency(lineTotals.total)}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  className="btn-ghost flex items-center gap-2 text-danger-500 hover:text-danger-700"
                  aria-label={`Remove ${item.productName}`}
                  onClick={() => onRemove(item.key)}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
