import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { Order } from '@/types';

interface OrderDetailsContentProps {
  order: Order;
  receiveError: string | null;
  voidError: string | null;
}

export function OrderDetailsContent({
  order,
  receiveError,
  voidError,
}: OrderDetailsContentProps) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-secondary-500">Provider</p>
          <p className="mt-2 font-medium text-secondary-900">{order.providerName}</p>
        </div>
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-secondary-500">Site</p>
          <p className="mt-2 font-medium text-secondary-900">{order.siteName}</p>
        </div>
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-secondary-500">Status</p>
          <p className="mt-2 font-medium capitalize text-secondary-900">
            {order.status.replace(/_/g, ' ')}
          </p>
        </div>
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-secondary-500">Created</p>
          <p className="mt-2 font-medium text-secondary-900">{formatDateTime(order.createdAt)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4">
        <p className="text-xs uppercase tracking-wide text-primary-700">Committed Total</p>
        <p className="mt-2 text-xl font-semibold text-primary-900">{formatCurrency(order.total)}</p>
      </div>

      {(order.linkedPurchases?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-success-200 bg-success-50 px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-success-700">Receipts</p>
              <p className="mt-2 font-medium text-success-900">
                {order.linkedPurchaseCount} purchase receipt{order.linkedPurchaseCount === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {order.linkedPurchases?.map(purchase => (
              <div
                key={purchase.id}
                className="flex flex-col gap-1 rounded-lg border border-success-200 bg-white px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-secondary-900">{purchase.purchaseNumber}</p>
                  <p className="text-secondary-500">{formatDateTime(purchase.createdAt)}</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="font-medium text-secondary-900">{formatCurrency(purchase.total)}</p>
                  <p className="capitalize text-secondary-500">
                    {purchase.status.replace(/_/g, ' ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-secondary-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-secondary-200">
            <thead className="bg-secondary-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Ordered</th>
                <th className="px-4 py-3">Received</th>
                <th className="px-4 py-3">Pending</th>
                <th className="px-4 py-3">Cost / Unit</th>
                <th className="px-4 py-3">Base Cost</th>
                <th className="px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-200 bg-white">
              {order.items?.map(item => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-secondary-900">
                        {item.productName ?? item.productId}
                      </p>
                      <p className="text-xs text-secondary-500">
                        {item.productSku ?? 'No SKU'}
                        {' · '}
                        {item.unitName ?? item.unitAbbreviation ?? item.unitId}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary-700">{item.quantity}</td>
                  <td className="px-4 py-3 text-sm text-secondary-700">
                    {item.receivedQuantity ?? 0}
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary-700">
                    {item.remainingQuantity ?? item.quantity}
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary-700">
                    {formatCurrency(item.costPerUnit)}
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary-700">
                    {formatCurrency(item.baseUnitCost)}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-secondary-900">
                    {formatCurrency(item.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {order.notes && (
        <div className="rounded-xl border border-secondary-200 px-4 py-4">
          <p className="text-sm text-secondary-500">Notes</p>
          <p className="mt-2 text-sm text-secondary-700">{order.notes}</p>
        </div>
      )}

      {receiveError && <p className="text-sm text-danger-500">{receiveError}</p>}
      {voidError && <p className="text-sm text-danger-500">{voidError}</p>}
    </div>
  );
}
