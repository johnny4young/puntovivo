import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { trpc } from '@/lib/trpc';
import { formatDateTime } from '@/lib/utils';
import { translateServerError } from '@/lib/translateServerError';
import type { TransferHistoryStatus } from '@/types';

interface InventoryTransferDetailsModalProps {
  isOpen: boolean;
  transferId: string | null;
  onClose: () => void;
}

const statusBadgeClasses: Record<TransferHistoryStatus, string> = {
  completed:
    'inline-flex items-center rounded-full bg-success-100 px-2 py-0.5 text-xs text-success-700',
  in_transit:
    'inline-flex items-center rounded-full bg-warning-100 px-2 py-0.5 text-xs text-warning-800',
  void: 'inline-flex items-center rounded-full bg-secondary-100 px-2 py-0.5 text-xs text-secondary-700',
};

/**
 * Read-only drawer that surfaces a transfer's line items plus its lifecycle
 * timestamps (created → received). Consumes `transfers.getById` lazily — the
 * query only fires once a `transferId` is supplied so closed state doesn't
 * hit the network.
 */
export function InventoryTransferDetailsModal({
  isOpen,
  transferId,
  onClose,
}: InventoryTransferDetailsModalProps) {
  const { t } = useTranslation(['inventory', 'errors']);

  const detailQuery = trpc.transfers.getById.useQuery(
    { id: transferId ?? '' },
    { enabled: isOpen && !!transferId }
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('transferDetails.title')}
      size="lg"
      footer={
        <div className="flex items-center justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('transferDetails.close')}
          </button>
        </div>
      }
    >
      {detailQuery.isLoading && !detailQuery.data && (
        <p className="text-sm text-secondary-500">{t('transferDetails.loading')}</p>
      )}
      {detailQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-2 text-sm text-danger-700">
          {translateServerError(
            detailQuery.error,
            t,
            t('transferDetails.error')
          )}
        </div>
      )}
      {detailQuery.data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-secondary-900">
              {detailQuery.data.fromSiteName || '—'}
            </span>
            <ArrowRight className="h-4 w-4 text-secondary-400" />
            <span className="font-medium text-secondary-900">
              {detailQuery.data.toSiteName || '—'}
            </span>
            <span className={statusBadgeClasses[detailQuery.data.status]}>
              {t(`transferHistory.status.${detailQuery.data.status}`)}
            </span>
          </div>

          <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-secondary-500">
                {t('transferDetails.createdAt')}
              </dt>
              <dd className="text-sm text-secondary-900">
                {formatDateTime(detailQuery.data.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-secondary-500">
                {t('transferDetails.receivedAt')}
              </dt>
              <dd className="text-sm text-secondary-900">
                {detailQuery.data.receivedAt
                  ? formatDateTime(detailQuery.data.receivedAt)
                  : t('transferDetails.notReceived')}
              </dd>
            </div>
          </dl>

          {detailQuery.data.notes && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-secondary-500">
                {t('transferDetails.notes')}
              </p>
              <p className="whitespace-pre-line text-sm text-secondary-700">
                {detailQuery.data.notes}
              </p>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-secondary-500">
              {t('transferDetails.lineItems')}
            </p>
            <div className="overflow-hidden rounded-xl border border-secondary-200">
              <table className="min-w-full divide-y divide-secondary-200 text-sm">
                <thead className="bg-secondary-50 text-xs uppercase tracking-wide text-secondary-500">
                  <tr>
                    <th className="px-3 py-2 text-left">
                      {t('transferDetails.columns.product')}
                    </th>
                    <th className="px-3 py-2 text-left">
                      {t('transferDetails.columns.sku')}
                    </th>
                    <th className="px-3 py-2 text-right">
                      {t('transferDetails.columns.quantity')}
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
                      <td className="px-3 py-2 text-right font-medium text-secondary-900">
                        {item.quantity.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
