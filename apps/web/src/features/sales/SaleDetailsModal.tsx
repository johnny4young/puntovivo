import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { trpc } from '@/lib/trpc';
import { formatCurrency, formatDateTime } from '@/lib/utils';

interface SaleDetailsModalProps {
  saleId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SaleDetailsModal({ saleId, isOpen, onClose }: SaleDetailsModalProps) {
  const saleQuery = trpc.sales.getById.useQuery(
    {
      id: saleId ?? '',
    },
    {
      enabled: isOpen && !!saleId,
    }
  );

  const sale = saleQuery.data;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={sale ? `Sale ${sale.saleNumber}` : 'Sale Details'}
      size="full"
      footer={<ModalButton onClick={onClose}>Close</ModalButton>}
    >
      {saleQuery.isLoading && <p className="text-sm text-secondary-500">Loading sale details...</p>}
      {saleQuery.error && <p className="text-sm text-danger-500">{saleQuery.error.message}</p>}

      {sale && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
              <p className="text-xs uppercase tracking-wide text-secondary-500">Customer</p>
              <p className="mt-2 font-medium text-secondary-900">{sale.customerName ?? 'Walk-in'}</p>
            </div>
            <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
              <p className="text-xs uppercase tracking-wide text-secondary-500">Payment</p>
              <p className="mt-2 font-medium capitalize text-secondary-900">{sale.paymentMethod}</p>
              <p className="text-sm capitalize text-secondary-500">{sale.paymentStatus}</p>
            </div>
            <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
              <p className="text-xs uppercase tracking-wide text-secondary-500">Status</p>
              <p className="mt-2 font-medium capitalize text-secondary-900">{sale.status}</p>
            </div>
            <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
              <p className="text-xs uppercase tracking-wide text-secondary-500">Created</p>
              <p className="mt-2 font-medium text-secondary-900">{formatDateTime(sale.createdAt)}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-secondary-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-secondary-200">
                <thead className="bg-secondary-50">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Quantity</th>
                    <th className="px-4 py-3">Unit price</th>
                    <th className="px-4 py-3">Tax</th>
                    <th className="px-4 py-3">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-200 bg-white">
                  {sale.items?.map(item => (
                    <tr key={item.id}>
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-secondary-900">
                            {item.productName ?? item.productId}
                          </p>
                          <p className="text-xs text-secondary-500">
                            {item.productSku ?? 'No SKU'}
                            {' · '}
                            {item.unitName ?? item.unitAbbreviation ?? item.unitId ?? 'Unit'}
                          </p>
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

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-secondary-200 px-4 py-4">
              <p className="text-sm text-secondary-500">Subtotal</p>
              <p className="mt-1 text-lg font-semibold text-secondary-900">
                {formatCurrency(sale.subtotal)}
              </p>
            </div>
            <div className="rounded-xl border border-secondary-200 px-4 py-4">
              <p className="text-sm text-secondary-500">VAT</p>
              <p className="mt-1 text-lg font-semibold text-secondary-900">
                {formatCurrency(sale.taxAmount)}
              </p>
            </div>
            <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4">
              <p className="text-sm text-primary-700">Total</p>
              <p className="mt-1 text-xl font-semibold text-primary-900">{formatCurrency(sale.total)}</p>
            </div>
          </div>

          {sale.notes && (
            <div className="rounded-xl border border-secondary-200 px-4 py-4">
              <p className="text-sm text-secondary-500">Notes</p>
              <p className="mt-2 text-sm text-secondary-700">{sale.notes}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
