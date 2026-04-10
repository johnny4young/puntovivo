import { useState } from 'react';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { PurchaseDetailsContent } from '@/features/purchases/PurchaseDetailsContent';
import {
  PurchaseReturnModal,
  type PurchaseReturnValues,
} from '@/features/purchases/PurchaseReturnModal';
import { trpc } from '@/lib/trpc';
import { getErrorMessage } from '@/lib/utils';

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
      await Promise.all([
        utils.purchases.list.invalidate(),
        utils.purchases.getById.invalidate({ id: purchaseId ?? '' }),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
        utils.dashboard.summary.invalidate(),
      ]);
      toast.success({ title: 'Purchase return recorded and stock reduced' });
      setIsReturnModalOpen(false);
      setReturnError(null);
    },
    onError: error => {
      const message = getErrorMessage(error, 'Unable to record the purchase return');
      setReturnError(message);
      toast.error({
        title: 'Unable to return purchase items',
        description: message,
      });
    },
  });

  const voidMutation = trpc.purchases.void.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.purchases.list.invalidate(),
        utils.purchases.getById.invalidate({ id: purchaseId ?? '' }),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
        utils.dashboard.summary.invalidate(),
      ]);
      toast.success({ title: 'Purchase voided and stock reversed' });
      setIsVoidConfirmOpen(false);
      setVoidError(null);
      onClose();
    },
    onError: error => {
      const message = getErrorMessage(error, 'Unable to void the purchase');
      setVoidError(message);
      toast.error({
        title: 'Unable to void purchase',
        description: message,
      });
    },
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
        title={purchase ? `Purchase ${purchase.purchaseNumber}` : 'Purchase Details'}
        size="full"
        footer={
          <>
            {canReturnPurchase && (
              <ModalButton
                onClick={handleOpenReturnModal}
                variant="primary"
                disabled={returnMutation.isPending || voidMutation.isPending}
              >
                Return Items
              </ModalButton>
            )}
            {canVoidPurchase && (
              <ModalButton
                onClick={() => setIsVoidConfirmOpen(true)}
                variant="danger"
                disabled={returnMutation.isPending || voidMutation.isPending}
              >
                Void Purchase
              </ModalButton>
            )}
            <ModalButton onClick={handleClose}>Close</ModalButton>
          </>
        }
      >
        {purchaseQuery.isLoading && (
          <p className="text-sm text-secondary-500">Loading purchase details...</p>
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
        title="Void Purchase"
        message="Voiding this purchase will subtract all received stock from inventory. Use item returns instead when only part of the receipt is going back to the provider."
        confirmText="Void Purchase"
        loading={voidMutation.isPending}
        variant="danger"
      />
    </>
  );
}
