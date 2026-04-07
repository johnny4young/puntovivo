import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { trpc } from '@/lib/trpc';
import { formatCurrency, formatDateTime } from '@/lib/utils';

interface PurchaseDetailsModalProps {
  purchaseId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function PurchaseDetailsModal({
  purchaseId,
  isOpen,
  onClose,
}: PurchaseDetailsModalProps) {
  const purchaseQuery = trpc.purchases.getById.useQuery(
    {
      id: purchaseId ?? '',
    },
    {
      enabled: isOpen && !!purchaseId,
    }
  );

  const purchase = purchaseQuery.data;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={purchase ? `Purchase ${purchase.purchaseNumber}` : 'Purchase Details'}
      size="full"
      footer={<ModalButton onClick={onClose}>Close</ModalButton>}
    >
      {purchaseQuery.isLoading && (
        <p className="text-sm text-secondary-500">Loading purchase details...</p>
      )}
      {purchaseQuery.error && <p className="text-sm text-danger-500">{purchaseQuery.error.message}</p>}

      {purchase && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
              <p className="text-xs uppercase tracking-wide text-secondary-500">Provider</p>
              <p className="mt-2 font-medium text-secondary-900">{purchase.providerName}</p>
            </div>
            <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
              <p className="text-xs uppercase tracking-wide text-secondary-500">Site</p>
              <p className="mt-2 font-medium text-secondary-900">{purchase.siteName}</p>
            </div>
            <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
              <p className="text-xs uppercase tracking-wide text-secondary-500">Created</p>
              <p className="mt-2 font-medium text-secondary-900">{formatDateTime(purchase.createdAt)}</p>
            </div>
            <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4">
              <p className="text-xs uppercase tracking-wide text-primary-700">Total</p>
              <p className="mt-2 text-xl font-semibold text-primary-900">
                {formatCurrency(purchase.total)}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-secondary-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-secondary-200">
                <thead className="bg-secondary-50">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Quantity</th>
                    <th className="px-4 py-3">Cost / Unit</th>
                    <th className="px-4 py-3">Base Cost</th>
                    <th className="px-4 py-3">Total</th>
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
                            {item.productSku ?? 'No SKU'}
                            {' · '}
                            {item.unitName ?? item.unitAbbreviation ?? item.unitId}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-secondary-700">{item.quantity}</td>
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

          {purchase.notes && (
            <div className="rounded-xl border border-secondary-200 px-4 py-4">
              <p className="text-sm text-secondary-500">Notes</p>
              <p className="mt-2 text-sm text-secondary-700">{purchase.notes}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
