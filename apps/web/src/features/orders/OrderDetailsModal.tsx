import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { OrderDetailsContent } from '@/features/orders/OrderDetailsContent';
import {
  OrderReceiveModal,
  type OrderReceiveValues,
} from '@/features/orders/OrderReceiveModal';
import { trpc } from '@/lib/trpc';
import { getErrorMessage } from '@/lib/utils';

interface OrderDetailsModalProps {
  orderId: string | null;
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'details' | 'receive';
}

export function OrderDetailsModal({
  orderId,
  isOpen,
  onClose,
  initialMode = 'details',
}: OrderDetailsModalProps) {
  const { t } = useTranslation(['orders', 'common']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(initialMode === 'receive');
  const [receiveModalKey, setReceiveModalKey] = useState(0);
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
        utils.inventory.listBalancesBySite.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
      ]);
      toast.success({
        title: t('orders:details.toast.receiveSuccessTitle'),
        description: t('orders:details.toast.receiveSuccessDescription', {
          purchaseNumber: purchase.purchaseNumber,
        }),
      });
      setIsReceiveModalOpen(false);
      setReceiveError(null);
      onClose();
    },
    onError: error => {
      const message = getErrorMessage(error, t('orders:details.toast.receiveErrorFallback'));
      setReceiveError(message);
      toast.error({
        title: t('orders:details.toast.receiveErrorTitle'),
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
      toast.success({ title: t('orders:details.toast.voidSuccessTitle') });
      setIsVoidConfirmOpen(false);
      setVoidError(null);
      onClose();
    },
    onError: error => {
      const message = getErrorMessage(error, t('orders:details.toast.voidErrorFallback'));
      setVoidError(message);
      toast.error({
        title: t('orders:details.toast.voidErrorTitle'),
        description: message,
      });
    },
  });

  const orderQuery = trpc.orders.getById.useQuery(
    { id: orderId ?? '' },
    { enabled: isOpen && !!orderId }
  );

  const order = orderQuery.data;
  const hasRemainingItems =
    (order?.items ?? []).some(item => (item.remainingQuantity ?? item.quantity) > 0) ?? false;
  const canReceiveOrder =
    (user?.role === 'admin' || user?.role === 'manager') &&
    (order?.status === 'submitted' || order?.status === 'partial_received') &&
    hasRemainingItems;
  const canVoidOrder = user?.role === 'admin' && order?.status === 'submitted';

  const handleClose = () => {
    setIsReceiveModalOpen(false);
    setIsVoidConfirmOpen(false);
    setReceiveError(null);
    setVoidError(null);
    onClose();
  };

  const handleOpenReceiveModal = () => {
    setReceiveError(null);
    setReceiveModalKey(current => current + 1);
    setIsReceiveModalOpen(true);
  };

  const handleReceiveOrder = async (values: OrderReceiveValues) => {
    if (!orderId) {
      return;
    }

    setReceiveError(null);

    try {
      await receiveMutation.mutateAsync({
        orderId,
        items: values.items,
        notes: values.notes || undefined,
      });
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
        title={
          order
            ? t('orders:details.modalTitle', { orderNumber: order.orderNumber })
            : t('orders:details.modalFallbackTitle')
        }
        size="full"
        footer={
          <>
            {canReceiveOrder && (
              <ModalButton
                onClick={handleOpenReceiveModal}
                variant="primary"
                disabled={receiveMutation.isPending}
              >
                {t('orders:details.actions.receiveItems')}
              </ModalButton>
            )}
            {canVoidOrder && (
              <ModalButton
                onClick={() => setIsVoidConfirmOpen(true)}
                variant="danger"
                disabled={voidMutation.isPending}
              >
                {t('orders:confirm.void.confirmText')}
              </ModalButton>
            )}
            <ModalButton onClick={handleClose}>{t('common:actions.close')}</ModalButton>
          </>
        }
      >
        {orderQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('orders:details.loading')}</p>
        )}
        {orderQuery.error && <p className="text-sm text-danger-500">{orderQuery.error.message}</p>}
        {order && (
          <OrderDetailsContent
            order={order}
            receiveError={receiveError}
            voidError={voidError}
          />
        )}
      </Modal>

      {order && canReceiveOrder && (
        <OrderReceiveModal
          key={receiveModalKey}
          isOpen={isReceiveModalOpen}
          order={order}
          isSaving={receiveMutation.isPending}
          error={receiveError}
          onClose={() => setIsReceiveModalOpen(false)}
          onSubmit={handleReceiveOrder}
        />
      )}

      <ConfirmModal
        isOpen={isVoidConfirmOpen}
        onClose={() => setIsVoidConfirmOpen(false)}
        onConfirm={() => {
          void handleVoidOrder();
        }}
        title={t('confirm.void.title')}
        message={t('confirm.void.message')}
        confirmText={t('confirm.void.confirmText')}
        loading={voidMutation.isPending}
        variant="danger"
      />
    </>
  );
}
