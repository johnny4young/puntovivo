import { Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import {
  getOrderLineTotal,
  getOrderNormalizedQuantity,
  type OrderCartItem,
} from '@/features/orders/orderCart';

interface OrderCartTableProps {
  items: OrderCartItem[];
  onQuantityChange: (itemKey: string, quantity: number) => void;
  onCostChange: (itemKey: string, costPerUnit: number) => void;
  onRemove: (itemKey: string) => void;
}

export function OrderCartTable({
  items,
  onQuantityChange,
  onCostChange,
  onRemove,
}: OrderCartTableProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-secondary-300 bg-secondary-50 px-4 py-10 text-center text-sm text-secondary-500">
        Search and add products to start a purchase order.
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
              <th className="px-4 py-3">Cost / Unit</th>
              <th className="px-4 py-3">Base Units</th>
              <th className="px-4 py-3">Line Total</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-200 bg-white">
            {items.map(item => (
              <tr key={item.key}>
                <td className="px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-secondary-900">{item.productName}</p>
                    <p className="text-xs text-secondary-500">
                      {item.productSku}
                      {' · '}
                      {item.unitName}
                      {' · '}
                      Current stock {item.currentStock}
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
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input w-32"
                    value={item.costPerUnit}
                    onChange={event =>
                      onCostChange(item.key, Math.max(0, Number(event.target.value) || 0))
                    }
                  />
                </td>
                <td className="px-4 py-3 text-sm text-secondary-700">
                  {getOrderNormalizedQuantity(item)}
                </td>
                <td className="px-4 py-3 text-sm font-medium text-secondary-900">
                  {formatCurrency(getOrderLineTotal(item))}
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
