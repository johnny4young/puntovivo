import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('orders');

  const progress = (order.items ?? []).reduce(
    (summary, item) => {
      summary.ordered += item.quantity;
      summary.received += item.receivedQuantity ?? 0;
      summary.pending += item.remainingQuantity ?? item.quantity;
      return summary;
    },
    { ordered: 0, received: 0, pending: 0 }
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-secondary-500">{t('details.provider')}</p>
          <p className="mt-2 font-medium text-secondary-900">{order.providerName}</p>
        </div>
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-secondary-500">{t('details.site')}</p>
          <p className="mt-2 font-medium text-secondary-900">{order.siteName}</p>
        </div>
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-secondary-500">{t('details.status')}</p>
          <p className="mt-2 font-medium capitalize text-secondary-900">
            {t(`status.${order.status}`)}
          </p>
        </div>
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-secondary-500">{t('details.created')}</p>
          <p className="mt-2 font-medium text-secondary-900">{formatDateTime(order.createdAt)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4">
        <p className="text-xs uppercase tracking-wide text-primary-700">{t('details.committedTotal')}</p>
        <p className="mt-2 text-xl font-semibold text-primary-900">{formatCurrency(order.total)}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-secondary-500">{t('details.orderedUnits')}</p>
          <p className="mt-2 text-xl font-semibold text-secondary-900">{progress.ordered}</p>
        </div>
        <div className="rounded-xl border border-success-200 bg-success-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-success-700">{t('details.receivedUnits')}</p>
          <p className="mt-2 text-xl font-semibold text-success-900">{progress.received}</p>
        </div>
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-warning-700">{t('details.pendingUnits')}</p>
          <p className="mt-2 text-xl font-semibold text-warning-900">{progress.pending}</p>
        </div>
      </div>

      {order.status === 'partial_received' && (
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-warning-700">{t('details.stagedDelivery')}</p>
          <p className="mt-2 font-medium text-warning-900">
            {t('details.receiptCount', { count: order.linkedPurchaseCount ?? 0 })} {t('details.registeredSoFar')}
          </p>
          <p className="text-sm text-warning-800">
            {order.receivedPurchaseNumber
              ? `${t('details.latestReceipt', { number: order.receivedPurchaseNumber })} ${t('details.keepReceiving')}`
              : t('details.keepReceiving')}
          </p>
        </div>
      )}

      {(order.linkedPurchases?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-success-200 bg-success-50 px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-success-700">{t('details.receipts')}</p>
              <p className="mt-2 font-medium text-success-900">
                {t('details.receiptCount', { count: order.linkedPurchaseCount ?? 0 })}
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
                    {t(`status.${purchase.status}`)}
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
                <th className="px-4 py-3">{t('details.product')}</th>
                <th className="px-4 py-3">{t('details.ordered')}</th>
                <th className="px-4 py-3">{t('details.received')}</th>
                <th className="px-4 py-3">{t('details.pending')}</th>
                <th className="px-4 py-3">{t('details.costPerUnit')}</th>
                <th className="px-4 py-3">{t('details.baseCost')}</th>
                <th className="px-4 py-3">{t('details.total')}</th>
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
                        {item.productSku ?? t('details.noSku')}
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
          <p className="text-sm text-secondary-500">{t('details.notes')}</p>
          <p className="mt-2 text-sm text-secondary-700">{order.notes}</p>
        </div>
      )}

      {receiveError && <p className="text-sm text-danger-500">{receiveError}</p>}
      {voidError && <p className="text-sm text-danger-500">{voidError}</p>}
    </div>
  );
}
