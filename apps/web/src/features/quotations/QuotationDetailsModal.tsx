import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/form-controls/Modal';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { QUOTATION_STATUS_BADGE_CLASSES } from './quotationStatus';

interface QuotationDetailsModalProps {
  isOpen: boolean;
  quotationId: string | null;
  onClose: () => void;
}

/**
 * Read-only drawer that surfaces a quotation's line items, totals, customer
 * + status timeline. The query is gated on `isOpen && quotationId` so closed
 * state never hits the network.
 */
export function QuotationDetailsModal({
  isOpen,
  quotationId,
  onClose,
}: QuotationDetailsModalProps) {
  const { t } = useTranslation(['quotations', 'errors']);

  const detailQuery = trpc.quotations.getById.useQuery(
    { id: quotationId ?? '' },
    { enabled: isOpen && !!quotationId }
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('details.title')}
      size="xl"
      footer={
        <div className="flex items-center justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('details.close')}
          </button>
        </div>
      }
    >
      {detailQuery.isLoading && !detailQuery.data && (
        <p className="text-sm text-secondary-500">{t('details.loading')}</p>
      )}
      {detailQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-2 text-sm text-danger-700">
          {translateServerError(detailQuery.error, t, t('details.error'))}
        </div>
      )}
      {detailQuery.data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm text-secondary-700">
                {detailQuery.data.quotationNumber}
              </span>
              <span className={QUOTATION_STATUS_BADGE_CLASSES[detailQuery.data.status]}>
                {t(`status.${detailQuery.data.status}`)}
              </span>
            </div>
            <span className="text-sm text-secondary-600">
              {detailQuery.data.customerName ?? t('history.customerNone')}
            </span>
          </div>

          <dl className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-secondary-500">
                {t('details.createdAt')}
              </dt>
              <dd className="text-sm text-secondary-900">
                {formatDateTime(detailQuery.data.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-secondary-500">
                {t('details.createdBy')}
              </dt>
              <dd className="text-sm text-secondary-900">
                {detailQuery.data.createdByName ?? detailQuery.data.createdBy}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-secondary-500">
                {t('details.validUntil')}
              </dt>
              <dd className="text-sm text-secondary-900">
                {detailQuery.data.validUntil
                  ? formatDate(detailQuery.data.validUntil)
                  : t('history.validUntilNever')}
              </dd>
            </div>
            {detailQuery.data.statusChangedAt && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-secondary-500">
                  {t('details.statusChangedAt')}
                </dt>
                <dd className="text-sm text-secondary-900">
                  {formatDateTime(detailQuery.data.statusChangedAt)}
                  {detailQuery.data.statusChangedByName
                    ? ` — ${detailQuery.data.statusChangedByName}`
                    : ''}
                </dd>
              </div>
            )}
          </dl>

          {detailQuery.data.notes && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-secondary-500">
                {t('details.notes')}
              </p>
              <p className="whitespace-pre-line text-sm text-secondary-700">
                {detailQuery.data.notes}
              </p>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-secondary-500">
              {t('details.lineItems')}
            </p>
            <div className="overflow-x-auto rounded-xl border border-secondary-200">
              <table className="min-w-full divide-y divide-secondary-200 text-sm">
                <thead className="bg-secondary-50 text-xs uppercase tracking-wide text-secondary-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">
                      {t('details.columns.product')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left">
                      {t('details.columns.sku')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      {t('details.columns.quantity')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      {t('details.columns.unitPrice')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      {t('details.columns.discount')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      {t('details.columns.tax')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      {t('details.columns.total')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-100">
                  {detailQuery.data.items.map(item => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-secondary-900">{item.productName}</td>
                      <td className="px-3 py-2 font-mono text-xs text-secondary-600">
                        {item.productSku}
                      </td>
                      <td className="px-3 py-2 text-right text-secondary-900">
                        {item.quantity.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right text-secondary-900">
                        {formatCurrency(item.unitPrice)}
                      </td>
                      <td className="px-3 py-2 text-right text-secondary-700">
                        {item.discount > 0 ? `${item.discount}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-secondary-700">
                        {item.taxRate > 0 ? `${item.taxRate}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-secondary-900">
                        {formatCurrency(item.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2 rounded-xl border border-secondary-200 px-4 py-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-secondary-500">
                {t('details.totals.subtotal')}
              </dt>
              <dd className="font-medium text-secondary-900">
                {formatCurrency(detailQuery.data.subtotal)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-secondary-500">
                {t('details.totals.tax')}
              </dt>
              <dd className="font-medium text-secondary-900">
                {formatCurrency(detailQuery.data.taxAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-secondary-500">
                {t('details.totals.discount')}
              </dt>
              <dd className="font-medium text-secondary-900">
                {formatCurrency(detailQuery.data.discountAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-secondary-500">
                {t('details.totals.total')}
              </dt>
              <dd className="text-base font-semibold text-secondary-900">
                {formatCurrency(detailQuery.data.total)}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </Modal>
  );
}
