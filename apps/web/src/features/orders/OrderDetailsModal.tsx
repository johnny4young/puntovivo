import { useState } from 'react';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';
import { formatCurrency, formatDateTime, getErrorMessage } from '@/lib/utils';

interface OrderDetailsModalProps {
  orderId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function OrderDetailsModal({ orderId, isOpen, onClose }: OrderDetailsModalProps) {
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [isReceiveConfirmOpen, setIsReceiveConfirmOpen] = useState(false);
  const [isVoidConfirmOpen, setIsVoidConfirmOpen] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const receiveMutation = trpc.purchases.createFromOrder.useMutation({
    onSuccess: async purchase => {
      await Promise.all([
        utils.orders.list.invalidate(),
        utils.orders.getById.invalidate({ id: orderId ?? '' }),
        utils.purchases.list.invalidate(),
        utils.purchases.getById.invalidate({ id: purchase.id }),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
      ]);
      toast.success({
        title: 'Order received into purchase',
        description: `Created purchase ${purchase.purchaseNumber}.`,
      });
      setIsReceiveConfirmOpen(false);
      setReceiveError(null);
      onClose();
    },
    onError: error => {
      const message = getErrorMessage(error, 'Unable to receive the order');
      setReceiveError(message);
      toast.error({
        title: 'Unable to receive order',
        description: message,
      });
    },
  });
  const voidMutation = trpc.orders.void.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.orders.list.invalidate(),
        utils.orders.getById.invalidate({ id: orderId ?? '' }),
      ]);
      toast.success({ title: 'Purchase order voided' });
      setIsVoidConfirmOpen(false);
      setVoidError(null);
      onClose();
    },
    onError: error => {
      const message = getErrorMessage(error, 'Unable to void the order');
      setVoidError(message);
      toast.error({
        title: 'Unable to void order',
        description: message,
      });
    },
  });
  const orderQuery = trpc.orders.getById.useQuery(
    {
      id: orderId ?? '',
    },
    {
      enabled: isOpen && !!orderId,
    }
  );

  const order = orderQuery.data;
  const canReceiveOrder =
    (user?.role === 'admin' || user?.role === 'manager') && order?.status === 'submitted';
  const canVoidOrder = user?.role === 'admin' && order?.status === 'submitted';

  const handleClose = () => {
    setIsReceiveConfirmOpen(false);
    setIsVoidConfirmOpen(false);
    setReceiveError(null);
    setVoidError(null);
    onClose();
  };

  const handleReceiveOrder = async () => {
    if (!orderId) {
      return;
    }

    setReceiveError(null);

    try {
      await receiveMutation.mutateAsync({ orderId });
    } catch {
      // Error state is handled by the mutation callbacks.
    }
  };

  const handleVoidOrder = async () => {
    if (!orderId) {
      return;
    }

    setVoidError(null);

    try {
      await voidMutation.mutateAsync({ id: orderId });
    } catch {
      // Error state is handled by the mutation callbacks.
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={order ? `Purchase Order ${order.orderNumber}` : 'Purchase Order Details'}
        size="full"
        footer={
          <>
            {canReceiveOrder && (
              <ModalButton
                onClick={() => setIsReceiveConfirmOpen(true)}
                variant="primary"
                disabled={receiveMutation.isPending}
              >
                Receive Order
              </ModalButton>
            )}
            {canVoidOrder && (
              <ModalButton
                onClick={() => setIsVoidConfirmOpen(true)}
                variant="danger"
                disabled={voidMutation.isPending}
              >
                Void Order
              </ModalButton>
            )}
            <ModalButton onClick={handleClose}>Close</ModalButton>
          </>
        }
      >
        {orderQuery.isLoading && (
          <p className="text-sm text-secondary-500">Loading purchase order details...</p>
        )}
        {orderQuery.error && <p className="text-sm text-danger-500">{orderQuery.error.message}</p>}

        {order && (
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
                <p className="mt-2 font-medium capitalize text-secondary-900">{order.status}</p>
              </div>
              <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
                <p className="text-xs uppercase tracking-wide text-secondary-500">Created</p>
                <p className="mt-2 font-medium text-secondary-900">{formatDateTime(order.createdAt)}</p>
              </div>
            </div>

            <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4">
              <p className="text-xs uppercase tracking-wide text-primary-700">Committed Total</p>
              <p className="mt-2 text-xl font-semibold text-primary-900">
                {formatCurrency(order.total)}
              </p>
            </div>

            {order.receivedPurchaseNumber && (
              <div className="rounded-xl border border-success-200 bg-success-50 px-4 py-4">
                <p className="text-xs uppercase tracking-wide text-success-700">Received Purchase</p>
                <p className="mt-2 font-medium text-success-900">{order.receivedPurchaseNumber}</p>
              </div>
            )}

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
        )}
      </Modal>

      <ConfirmModal
        isOpen={isReceiveConfirmOpen}
        onClose={() => setIsReceiveConfirmOpen(false)}
        onConfirm={() => {
          void handleReceiveOrder();
        }}
        title="Receive Purchase Order"
        message="Receiving this order will create a completed purchase, increase stock, and mark the order as received."
        confirmText="Receive Order"
        loading={receiveMutation.isPending}
        variant="primary"
      />

      <ConfirmModal
        isOpen={isVoidConfirmOpen}
        onClose={() => setIsVoidConfirmOpen(false)}
        onConfirm={() => {
          void handleVoidOrder();
        }}
        title="Void Purchase Order"
        message="Voiding this purchase order will keep the history record but mark it as inactive for operational follow-up."
        confirmText="Void Order"
        loading={voidMutation.isPending}
        variant="danger"
      />
    </>
  );
}
