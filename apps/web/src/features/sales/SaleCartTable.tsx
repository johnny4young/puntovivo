import { Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { getLineTotals, type SaleCartItem } from '@/features/sales/saleCart';

interface SaleCartTableProps {
  items: SaleCartItem[];
  onQuantityChange: (itemKey: string, quantity: number) => void;
  onDiscountChange: (itemKey: string, discount: number) => void;
  onRemove: (itemKey: string) => void;
}

export function SaleCartTable({
  items,
  onQuantityChange,
  onDiscountChange,
  onRemove,
}: SaleCartTableProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-secondary-300 bg-secondary-50 px-4 py-10 text-center text-sm text-secondary-500">
        Search and add products to start a sale.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-secondary-200">
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

              return (
                <tr key={item.key}>
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
                      type="number"
                      min={1}
                      step={1}
                      className="input w-24"
                      value={item.quantity}
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
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className="input w-24"
                      value={item.discount}
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
                      onClick={() => onRemove(item.key)}
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
  );
}
