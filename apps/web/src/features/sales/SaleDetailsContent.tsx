import { useTranslation } from 'react-i18next';
import { hasSplitPayments } from '@/features/sales/checkoutPayment';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { Sale } from '@/types';

interface SaleDetailsContentProps {
  sale: Sale;
  returnError: string | null;
  voidError: string | null;
  printError: string | null;
}

export function SaleDetailsContent({
  sale,
  returnError,
  voidError,
  printError,
}: SaleDetailsContentProps) {
  const { t } = useTranslation('sales');

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="surface-panel-muted">
          <p className="text-xs uppercase tracking-wide text-secondary-500">{t('details.customer')}</p>
          <p className="mt-2 font-medium text-secondary-900">{sale.customerName ?? t('details.walkIn')}</p>
        </div>
        <div className="surface-panel-muted">
          <p className="text-xs uppercase tracking-wide text-secondary-500">{t('details.payment')}</p>
          <p className="mt-2 font-medium capitalize text-secondary-900">{t(`payment.${sale.paymentMethod}`)}</p>
          <p className="text-sm capitalize text-secondary-500">{t(`paymentStatus.${sale.paymentStatus}`)}</p>
        </div>
        <div className="surface-panel-muted">
          <p className="text-xs uppercase tracking-wide text-secondary-500">{t('details.status')}</p>
          <p className="mt-2 font-medium capitalize text-secondary-900">{t(`status.${sale.status}`)}</p>
        </div>
        <div className="surface-panel-muted">
          <p className="text-xs uppercase tracking-wide text-secondary-500">{t('details.created')}</p>
          <p className="mt-2 font-medium text-secondary-900">{formatDateTime(sale.createdAt)}</p>
        </div>
      </div>

      {sale.paymentStatus === 'refunded' && (
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-warning-700">{t('details.refund')}</p>
          <p className="mt-2 font-medium text-warning-900">
            {sale.refundAmount ? formatCurrency(sale.refundAmount) : formatCurrency(sale.total)}
          </p>
          <p className="text-sm text-warning-800">
            {sale.returnReason ?? t('details.refundNoNote')}
          </p>
          {sale.returnedAt && (
            <p className="mt-1 text-xs text-warning-700">
              {t('details.processedOn', { date: formatDateTime(sale.returnedAt) })}
            </p>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-[22px] border border-line/80 bg-surface">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line/70">
            <thead className="bg-surface-2/86">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
                <th className="px-4 py-3">{t('details.product')}</th>
                <th className="px-4 py-3">{t('details.quantity')}</th>
                <th className="px-4 py-3">{t('details.unitPrice')}</th>
                <th className="px-4 py-3">{t('details.tax')}</th>
                <th className="px-4 py-3">{t('details.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70 bg-surface">
              {sale.items?.map(item => (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-secondary-900">
                        {item.productName ?? item.productId}
                      </p>
                      <p className="text-xs text-secondary-500">
                        {item.productSku ?? t('details.noSku')}
                        {' · '}
                        {item.unitName ?? item.unitAbbreviation ?? item.unitId ?? t('details.unit')}
                      </p>
                      {(item.serialNumbers?.length ?? 0) > 0 && (
                        <p className="mt-1 text-xs text-secondary-600">
                          {t('details.serials')}: {' '}
                          <span className="font-mono">{item.serialNumbers?.join(', ')}</span>
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary-700">{item.quantity}</td>
                  <td className="px-4 py-3 text-sm text-secondary-700">
                    {formatCurrency(item.unitPrice)}
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary-700">
                    {formatCurrency(item.taxAmount)}
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

      {hasSplitPayments(sale) && sale.payments && (
        <div className="overflow-hidden rounded-[22px] border border-line/80 bg-surface">
          <div className="flex items-center justify-between border-b border-line/70 bg-surface-2/86 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary-500">
              {t('details.paymentsHeading')}
            </p>
            <p className="text-xs text-secondary-500">
              {t('details.paymentsSplit', { count: sale.payments.length })}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line/70">
              <thead className="bg-surface-2/86">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
                  <th className="px-4 py-3">{t('details.paymentsMethod')}</th>
                  <th className="px-4 py-3">{t('details.paymentsReference')}</th>
                  <th className="px-4 py-3 text-right">{t('details.paymentsAmount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70 bg-surface">
                {sale.payments.map(payment => (
                  <tr key={payment.id}>
                    <td className="px-4 py-3 text-sm font-medium text-secondary-900">
                      {t(`payment.${payment.method}`)}
                    </td>
                    <td className="px-4 py-3 text-sm text-secondary-700">
                      {payment.reference?.trim() || t('details.paymentsNoReference')}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-secondary-900">
                      {formatCurrency(payment.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="surface-panel">
          <p className="text-sm text-secondary-500">{t('details.subtotal')}</p>
          <p className="mt-1 text-lg font-semibold text-secondary-900">
            {formatCurrency(sale.subtotal)}
          </p>
        </div>
        <div className="surface-panel">
          <p className="text-sm text-secondary-500">{t('details.vat')}</p>
          <p className="mt-1 text-lg font-semibold text-secondary-900">
            {formatCurrency(sale.taxAmount)}
          </p>
        </div>
        <div className="rounded-[22px] border border-primary-300/30 bg-primary-400/12 px-4 py-4">
          <p className="text-sm text-primary-700">{t('details.total')}</p>
          <p className="mt-1 text-xl font-semibold text-primary-900">{formatCurrency(sale.total)}</p>
        </div>
      </div>

      {sale.notes && (
        <div className="surface-panel">
          <p className="text-sm text-secondary-500">{t('details.notes')}</p>
          <p className="mt-2 text-sm text-secondary-700">{sale.notes}</p>
        </div>
      )}

      {returnError && <p className="text-sm text-danger-500">{returnError}</p>}
      {voidError && <p className="text-sm text-danger-500">{voidError}</p>}
      {printError && <p className="text-sm text-danger-500">{printError}</p>}
    </div>
  );
}
