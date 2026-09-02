import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { OrderDetailsContent } from '@/features/orders/OrderDetailsContent';
import { OrderReceiveModal, type OrderReceiveValues } from '@/features/orders/OrderReceiveModal';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { useCriticalMutation } from '@/lib/useCriticalMutation';

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
  const { t } = useTranslation(['orders', 'inventoryControls', 'common', 'errors']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(initialMode === 'receive');
  const [receiveModalKey, setReceiveModalKey] = useState(0);
  const [isVoidConfirmOpen, setIsVoidConfirmOpen] = useState(false);
  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const orderQuery = trpc.orders.getById.useQuery(
    { id: orderId ?? '' },
    { enabled: isOpen && !!orderId }
  );
  const order = orderQuery.data;
  const isDraft = order?.status === 'draft';

  const receiveMutation = useCriticalMutation('purchases.createFromOrder', {
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
        utils.productSerials.list.invalidate(),
        utils.productSerials.lookup.invalidate(),
        utils.inventoryLots.list.invalidate(),
        utils.inventoryLots.expiring.invalidate(),
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
    onError: onErrorToast(toast, t, {
      titleKey: 'orders:details.toast.receiveErrorTitle',
      fallbackKey: 'orders:details.toast.receiveErrorFallback',
      extra: description => setReceiveError(description),
    }),
  });

  const voidMutation = useCriticalMutation('orders.void', {
    onSuccess: async () => {
      await Promise.all([
        utils.orders.list.invalidate(),
        utils.orders.getById.invalidate({ id: orderId ?? '' }),
      ]);
      toast.success({
        title: t(
          isDraft
            ? 'orders:details.toast.discardSuccessTitle'
            : 'orders:details.toast.voidSuccessTitle'
        ),
      });
      setIsVoidConfirmOpen(false);
      setVoidError(null);
      onClose();
    },
    onError: onErrorToast(toast, t, {
      titleKey: isDraft
        ? 'orders:details.toast.discardErrorTitle'
        : 'orders:details.toast.voidErrorTitle',
      fallbackKey: isDraft
        ? 'orders:details.toast.discardErrorFallback'
        : 'orders:details.toast.voidErrorFallback',
      extra: description => setVoidError(description),
    }),
  });

  const submitMutation = useCriticalMutation('orders.submitDraft', {
    onSuccess: async () => {
      await Promise.all([
        utils.orders.list.invalidate(),
        utils.orders.getById.invalidate({ id: orderId ?? '' }),
      ]);
      toast.success({ title: t('orders:details.toast.submitSuccessTitle') });
      setIsSubmitConfirmOpen(false);
      setSubmitError(null);
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'orders:details.toast.submitErrorTitle',
      fallbackKey: 'orders:details.toast.submitErrorFallback',
      extra: description => setSubmitError(description),
    }),
  });

  const hasRemainingItems =
    (order?.items ?? []).some(item => (item.remainingQuantity ?? item.quantity) > 0) ?? false;
  const canReceiveOrder =
    (user?.role === 'admin' || user?.role === 'manager') &&
    (order?.status === 'submitted' || order?.status === 'partial_received') &&
    hasRemainingItems;
  const canSubmitDraft =
    (user?.role === 'admin' || user?.role === 'manager') && order?.status === 'draft';
  const canVoidOrder =
    (user?.role === 'admin' && (order?.status === 'submitted' || isDraft)) ||
    (user?.role === 'manager' && isDraft);

  const handleClose = () => {
    setIsReceiveModalOpen(false);
    setIsVoidConfirmOpen(false);
    setIsSubmitConfirmOpen(false);
    setReceiveError(null);
    setVoidError(null);
    setSubmitError(null);
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

  const handleSubmitDraft = async () => {
    if (!orderId) return;
    setSubmitError(null);
    try {
      await submitMutation.mutateAsync({ id: orderId });
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
            {canSubmitDraft && (
              <ModalButton
                onClick={() => setIsSubmitConfirmOpen(true)}
                variant="primary"
                disabled={submitMutation.isPending}
              >
                {t('orders:details.actions.submitDraft')}
              </ModalButton>
            )}
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
                {t(
                  isDraft
                    ? 'orders:confirm.discardDraft.confirmText'
                    : 'orders:confirm.void.confirmText'
                )}
              </ModalButton>
            )}
            <ModalButton onClick={handleClose}>{t('common:actions.close')}</ModalButton>
          </>
        }
      >
        {orderQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('orders:details.loading')}</p>
        )}
        {orderQuery.error && (
          <p role="alert" className="text-sm text-danger-500">
            {translateServerError(orderQuery.error, t, t('errors:server.unknown'))}
          </p>
        )}
        {order && (
          <OrderDetailsContent
            order={order}
            receiveError={receiveError}
            voidError={voidError}
            submitError={submitError}
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
        isOpen={isSubmitConfirmOpen}
        onClose={() => setIsSubmitConfirmOpen(false)}
        onConfirm={() => {
          void handleSubmitDraft();
        }}
        title={t('confirm.submit.title')}
        message={t('confirm.submit.message')}
        confirmText={t('confirm.submit.confirmText')}
        loading={submitMutation.isPending}
        variant="primary"
      />

      <ConfirmModal
        isOpen={isVoidConfirmOpen}
        onClose={() => setIsVoidConfirmOpen(false)}
        onConfirm={() => {
          void handleVoidOrder();
        }}
        title={t(isDraft ? 'confirm.discardDraft.title' : 'confirm.void.title')}
        message={t(isDraft ? 'confirm.discardDraft.message' : 'confirm.void.message')}
        confirmText={t(isDraft ? 'confirm.discardDraft.confirmText' : 'confirm.void.confirmText')}
        loading={voidMutation.isPending}
        variant="danger"
      />
    </>
  );
}
