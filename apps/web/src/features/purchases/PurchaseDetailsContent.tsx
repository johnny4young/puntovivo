import { useTranslation } from 'react-i18next';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { Purchase } from '@/types';

interface PurchaseDetailsContentProps {
  purchase: Purchase;
  returnError: string | null;
  voidError: string | null;
}

export function PurchaseDetailsContent({
  purchase,
  returnError,
  voidError,
}: PurchaseDetailsContentProps) {
  const { t } = useTranslation('purchases');

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-secondary-500">{t('details.provider')}</p>
          <p className="mt-2 font-medium text-secondary-900">{purchase.providerName}</p>
        </div>
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-secondary-500">{t('details.site')}</p>
          <p className="mt-2 font-medium text-secondary-900">{purchase.siteName}</p>
        </div>
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-secondary-500">{t('details.status')}</p>
          <p className="mt-2 font-medium capitalize text-secondary-900">
            {t(`status.${purchase.status}`)}
          </p>
        </div>
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-secondary-500">{t('details.created')}</p>
          <p className="mt-2 font-medium text-secondary-900">{formatDateTime(purchase.createdAt)}</p>
        </div>
      </div>

      {purchase.sourceOrderNumber && (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-primary-700">{t('details.receivedFromOrder')}</p>
          <p className="mt-2 font-medium text-primary-900">{purchase.sourceOrderNumber}</p>
        </div>
      )}

      {purchase.returnCount ? (
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-warning-700">{t('details.supplierReturns')}</p>
          <p className="mt-2 font-medium text-warning-900">
            {t('details.recordedReturn', { count: purchase.returnCount })}
          </p>
          <p className="text-sm text-warning-800">
            {t('details.returnedToProvider', { amount: formatCurrency(purchase.returnedAmount ?? 0) })}
          </p>
          {purchase.returnedAt && (
            <p className="mt-1 text-xs text-warning-700">
              {t('details.latestReturnOn', { date: formatDateTime(purchase.returnedAt) })}
            </p>
          )}
          {purchase.latestReturnCreatedByName && (
            <p className="mt-1 text-xs text-warning-700">
              {t('details.registeredBy', { name: purchase.latestReturnCreatedByName })}
            </p>
          )}
          {purchase.latestReturnReason && (
            <p className="mt-1 text-sm text-warning-800">{purchase.latestReturnReason}</p>
          )}
        </div>
      ) : null}

      <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4">
        <p className="text-xs uppercase tracking-wide text-primary-700">{t('details.total')}</p>
        <p className="mt-2 text-xl font-semibold text-primary-900">
          {formatCurrency(purchase.total)}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-secondary-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-secondary-200">
            <thead className="bg-secondary-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
                <th className="px-4 py-3">{t('details.product')}</th>
                <th className="px-4 py-3">{t('details.received')}</th>
                <th className="px-4 py-3">{t('details.returned')}</th>
                <th className="px-4 py-3">{t('details.remaining')}</th>
                <th className="px-4 py-3">{t('details.costPerUnit')}</th>
                <th className="px-4 py-3">{t('details.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-200 bg-white">
              {purchase.items?.map(item => (
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
                    {item.returnedQuantity ?? 0}
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary-700">
                    {item.remainingQuantity ?? item.quantity}
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary-700">
                    {formatCurrency(item.costPerUnit)}
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

      {purchase.returns && purchase.returns.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary-500">
            {t('details.returnHistory')}
          </h3>
          {purchase.returns.map(returnRecord => (
            <div key={returnRecord.id} className="rounded-xl border border-secondary-200 px-4 py-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-secondary-900">
                    {formatCurrency(returnRecord.returnAmount)}
                  </p>
                  <p className="text-xs text-secondary-500">
                    {formatDateTime(returnRecord.createdAt)}
                  </p>
                  {returnRecord.createdByName && (
                    <p className="text-xs text-secondary-500">{returnRecord.createdByName}</p>
                  )}
                </div>
                <p className="text-sm text-secondary-700">
                  {returnRecord.reason ?? t('details.returnedWithoutNote')}
                </p>
              </div>
              {returnRecord.items && returnRecord.items.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {returnRecord.items.map(item => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-1 rounded-lg bg-secondary-50 px-3 py-2 text-sm text-secondary-700 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span>{item.productName ?? item.productId}</span>
                      <span>
                        {item.quantity} {item.unitAbbreviation ?? item.unitName ?? item.unitId}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {purchase.notes && (
        <div className="rounded-xl border border-secondary-200 px-4 py-4">
          <p className="text-sm text-secondary-500">{t('details.notes')}</p>
          <p className="mt-2 text-sm text-secondary-700">{purchase.notes}</p>
        </div>
      )}

      {returnError && <p className="text-sm text-danger-500">{returnError}</p>}
      {voidError && <p className="text-sm text-danger-500">{voidError}</p>}
    </div>
  );
}
