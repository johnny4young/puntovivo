import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { PurchaseDetailsContent } from '@/features/purchases/PurchaseDetailsContent';
import {
  PurchaseReturnModal,
  type PurchaseReturnValues,
} from '@/features/purchases/PurchaseReturnModal';
import { invalidateGroups } from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

interface PurchaseDetailsModalProps {
  purchaseId: string | null;
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'details' | 'return';
}

export function PurchaseDetailsModal({
  purchaseId,
  isOpen,
  onClose,
  initialMode = 'details',
}: PurchaseDetailsModalProps) {
  const { t } = useTranslation(['purchases', 'common']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(initialMode === 'return');
  const [returnModalKey, setReturnModalKey] = useState(0);
  const [isVoidConfirmOpen, setIsVoidConfirmOpen] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);

  const returnMutation = trpc.purchases.returnPurchase.useMutation({
    onSuccess: async () => {
      await invalidateGroups(utils, [
        u => u.purchases.list,
        u => u.purchases.getById,
        u => u.inventory.listMovements,
        u => u.inventory.listBalancesBySite,
        u => u.inventory.listStock,
        u => u.products.list,
        u => u.products.search,
        u => u.dashboard.summary,
      ]);
      toast.success({ title: t('purchases:details.toast.returnSuccessTitle') });
      setIsReturnModalOpen(false);
      setReturnError(null);
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'purchases:details.toast.returnErrorTitle',
      fallbackKey: 'purchases:details.toast.returnErrorFallback',
      extra: description => setReturnError(description),
    }),
  });

  const voidMutation = trpc.purchases.void.useMutation({
    onSuccess: async () => {
      await invalidateGroups(utils, [
        u => u.purchases.list,
        u => u.purchases.getById,
        u => u.inventory.listMovements,
        u => u.inventory.listBalancesBySite,
        u => u.inventory.listStock,
        u => u.products.list,
        u => u.products.search,
        u => u.dashboard.summary,
      ]);
      toast.success({ title: t('purchases:details.toast.voidSuccessTitle') });
      setIsVoidConfirmOpen(false);
      setVoidError(null);
      onClose();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'purchases:details.toast.voidErrorTitle',
      fallbackKey: 'purchases:details.toast.voidErrorFallback',
      extra: description => setVoidError(description),
    }),
  });

  const purchaseQuery = trpc.purchases.getById.useQuery(
    { id: purchaseId ?? '' },
    { enabled: isOpen && !!purchaseId }
  );

  const purchase = purchaseQuery.data;
  const canReturnPurchase =
    (user?.role === 'admin' || user?.role === 'manager') &&
    !!purchase &&
    (purchase.status === 'completed' || purchase.status === 'partial_returned');
  const canVoidPurchase = user?.role === 'admin' && purchase?.status === 'completed';

  const handleClose = () => {
    setIsReturnModalOpen(false);
    setIsVoidConfirmOpen(false);
    setReturnError(null);
    setVoidError(null);
    onClose();
  };

  const handleOpenReturnModal = () => {
    if (!purchase) {
      return;
    }

    setReturnError(null);
    setReturnModalKey(current => current + 1);
    setIsReturnModalOpen(true);
  };

  const handleReturnPurchase = async (values: PurchaseReturnValues) => {
    if (!purchaseId) {
      return;
    }

    setReturnError(null);

    try {
      await returnMutation.mutateAsync({
        id: purchaseId,
        items: values.items,
        reason: values.reason || undefined,
      });
    } catch {
      // Error state is handled by the mutation callbacks.
    }
  };

  const handleVoidPurchase = async () => {
    if (!purchaseId) {
      return;
    }

    setVoidError(null);

    try {
      await voidMutation.mutateAsync({ id: purchaseId });
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
          purchase
            ? t('purchases:details.modalTitle', { purchaseNumber: purchase.purchaseNumber })
            : t('purchases:details.modalFallbackTitle')
        }
        size="full"
        footer={
          <>
            {canReturnPurchase && (
              <ModalButton
                onClick={handleOpenReturnModal}
                variant="primary"
                disabled={returnMutation.isPending || voidMutation.isPending}
              >
                {t('purchases:details.actions.returnItems')}
              </ModalButton>
            )}
            {canVoidPurchase && (
              <ModalButton
                onClick={() => setIsVoidConfirmOpen(true)}
                variant="danger"
                disabled={returnMutation.isPending || voidMutation.isPending}
              >
                {t('purchases:confirm.void.confirmText')}
              </ModalButton>
            )}
            <ModalButton onClick={handleClose}>{t('common:actions.close')}</ModalButton>
          </>
        }
      >
        {purchaseQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('purchases:details.loading')}</p>
        )}
        {purchaseQuery.error && <p className="text-sm text-danger-500">{purchaseQuery.error.message}</p>}

        {purchase && (
          <PurchaseDetailsContent
            purchase={purchase}
            returnError={returnError}
            voidError={voidError}
          />
        )}
      </Modal>

      {purchase && canReturnPurchase && (
        <PurchaseReturnModal
          key={`${purchase.id}-${returnModalKey}-${purchase.returnCount ?? 0}`}
          isOpen={isReturnModalOpen}
          purchase={purchase}
          isSaving={returnMutation.isPending}
          error={returnError}
          onClose={() => setIsReturnModalOpen(false)}
          onSubmit={handleReturnPurchase}
        />
      )}

      <ConfirmModal
        isOpen={isVoidConfirmOpen}
        onClose={() => setIsVoidConfirmOpen(false)}
        onConfirm={() => {
          void handleVoidPurchase();
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
