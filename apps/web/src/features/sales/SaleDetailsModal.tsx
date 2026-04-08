import { useState } from 'react';
import { Printer } from 'lucide-react';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { printSaleReceipt } from '@/features/sales/receiptPrinter';
import { trpc } from '@/lib/trpc';
import { formatCurrency, formatDateTime, getErrorMessage } from '@/lib/utils';

interface SaleDetailsModalProps {
  saleId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SaleDetailsModal({ saleId, isOpen, onClose }: SaleDetailsModalProps) {
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [printError, setPrintError] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isVoidConfirmOpen, setIsVoidConfirmOpen] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const voidMutation = trpc.sales.void.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.sales.list.invalidate(),
        utils.sales.summary.invalidate(),
        utils.sales.getById.invalidate({ id: saleId ?? '' }),
        utils.dashboard.summary.invalidate(),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
      ]);
      toast.success({ title: 'Sale voided and stock restored' });
      setIsVoidConfirmOpen(false);
      setPrintError(null);
      setVoidError(null);
      onClose();
    },
    onError: error => {
      const message = getErrorMessage(error, 'Unable to void the sale');
      setVoidError(message);
      toast.error({
        title: 'Unable to void sale',
        description: message,
      });
    },
  });
  const saleQuery = trpc.sales.getById.useQuery(
    {
      id: saleId ?? '',
    },
    {
      enabled: isOpen && !!saleId,
    }
  );

  const sale = saleQuery.data;
  const canVoidSale = user?.role === 'admin' && sale?.status === 'completed';
  const handleClose = () => {
    setPrintError(null);
    setVoidError(null);
    setIsVoidConfirmOpen(false);
    onClose();
  };

  const handlePrint = async () => {
    if (!sale) {
      return;
    }

    setIsPrinting(true);
    setPrintError(null);

    try {
      await printSaleReceipt(sale);
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : 'Unable to print the receipt');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleVoidSale = async () => {
    if (!saleId) {
      return;
    }

    setVoidError(null);

    try {
      await voidMutation.mutateAsync({ id: saleId });
    } catch {
      // Error state is handled by the mutation callbacks.
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={sale ? `Sale ${sale.saleNumber}` : 'Sale Details'}
        size="full"
        footer={
          <>
            {canVoidSale && (
              <ModalButton
                onClick={() => setIsVoidConfirmOpen(true)}
                variant="danger"
                disabled={isPrinting || voidMutation.isPending}
              >
                Void Sale
              </ModalButton>
            )}
            <ModalButton
              onClick={handlePrint}
              variant="primary"
              disabled={!sale || isPrinting || voidMutation.isPending}
            >
              <span className="inline-flex items-center gap-2">
                <Printer className="h-4 w-4" />
                {isPrinting ? 'Printing...' : 'Print Receipt'}
              </span>
            </ModalButton>
            <ModalButton onClick={handleClose}>Close</ModalButton>
          </>
        }
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

            {voidError && <p className="text-sm text-danger-500">{voidError}</p>}
            {printError && <p className="text-sm text-danger-500">{printError}</p>}
          </div>
        )}
      </Modal>

      <ConfirmModal
        isOpen={isVoidConfirmOpen}
        onClose={() => setIsVoidConfirmOpen(false)}
        onConfirm={() => {
          void handleVoidSale();
        }}
        title="Void Sale"
        message="Voiding this sale will restore stock for all sale items and remove it from completed sales totals. This action cannot be undone."
        confirmText="Void Sale"
        loading={voidMutation.isPending}
        variant="danger"
      />
    </>
  );
}
