import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { SaleDetailsContent } from '@/features/sales/SaleDetailsContent';
import { printSaleReceipt } from '@/features/sales/receiptPrinter';
import { trpc } from '@/lib/trpc';
import { getErrorMessage } from '@/lib/utils';

interface SaleDetailsModalProps {
  saleId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SaleDetailsModal({ saleId, isOpen, onClose }: SaleDetailsModalProps) {
  const { t } = useTranslation(['sales', 'common']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [printError, setPrintError] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isReturnConfirmOpen, setIsReturnConfirmOpen] = useState(false);
  const [isVoidConfirmOpen, setIsVoidConfirmOpen] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);
  const returnMutation = trpc.sales.returnSale.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.cashSessions.getActive.invalidate(),
        utils.cashSessions.movements.invalidate(),
        utils.sales.list.invalidate(),
        utils.sales.summary.invalidate(),
        utils.sales.getById.invalidate({ id: saleId ?? '' }),
        utils.dashboard.summary.invalidate(),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
      ]);
      toast.success({ title: t('sales:details.toast.refundSuccessTitle') });
      setIsReturnConfirmOpen(false);
      setPrintError(null);
      setReturnError(null);
      onClose();
    },
    onError: error => {
      const message = getErrorMessage(error, t('sales:details.toast.refundErrorFallback'));
      setReturnError(message);
      toast.error({
        title: t('sales:details.toast.refundErrorTitle'),
        description: message,
      });
    },
  });
  const voidMutation = trpc.sales.void.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.cashSessions.getActive.invalidate(),
        utils.cashSessions.movements.invalidate(),
        utils.sales.list.invalidate(),
        utils.sales.summary.invalidate(),
        utils.sales.getById.invalidate({ id: saleId ?? '' }),
        utils.dashboard.summary.invalidate(),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
      ]);
      toast.success({ title: t('sales:details.toast.voidSuccessTitle') });
      setIsVoidConfirmOpen(false);
      setPrintError(null);
      setReturnError(null);
      setVoidError(null);
      onClose();
    },
    onError: error => {
      const message = getErrorMessage(error, t('sales:details.toast.voidErrorFallback'));
      setVoidError(message);
      toast.error({
        title: t('sales:details.toast.voidErrorTitle'),
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
  const canReturnSale =
    (user?.role === 'admin' || user?.role === 'manager') &&
    sale?.status === 'completed' &&
    sale.paymentStatus !== 'refunded';
  const canVoidSale =
    user?.role === 'admin' && sale?.status === 'completed' && sale.paymentStatus !== 'refunded';
  const handleClose = () => {
    setPrintError(null);
    setReturnError(null);
    setVoidError(null);
    setIsReturnConfirmOpen(false);
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
      setPrintError(
        error instanceof Error ? error.message : t('sales:details.toast.printErrorFallback')
      );
    } finally {
      setIsPrinting(false);
    }
  };

  const handleReturnSale = async () => {
    if (!saleId) {
      return;
    }

    setReturnError(null);

    try {
      await returnMutation.mutateAsync({ id: saleId });
    } catch {
      // Error state is handled by the mutation callbacks.
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
        title={
          sale
            ? t('sales:details.modalTitle', { saleNumber: sale.saleNumber })
            : t('sales:details.modalFallbackTitle')
        }
        size="full"
        footer={
          <>
            {canReturnSale && (
              <ModalButton
                onClick={() => setIsReturnConfirmOpen(true)}
                variant="primary"
                disabled={isPrinting || returnMutation.isPending || voidMutation.isPending}
              >
                {t('sales:confirm.refund.confirmText')}
              </ModalButton>
            )}
            {canVoidSale && (
              <ModalButton
                onClick={() => setIsVoidConfirmOpen(true)}
                variant="danger"
                disabled={isPrinting || returnMutation.isPending || voidMutation.isPending}
              >
                {t('sales:confirm.void.confirmText')}
              </ModalButton>
            )}
            <ModalButton
              onClick={handlePrint}
              variant="primary"
              disabled={!sale || isPrinting || returnMutation.isPending || voidMutation.isPending}
            >
              <span className="inline-flex items-center gap-2">
                <Printer className="h-4 w-4" />
                {isPrinting ? t('sales:details.actions.printing') : t('common:toolbar.print')}
              </span>
            </ModalButton>
            <ModalButton onClick={handleClose}>{t('common:actions.close')}</ModalButton>
          </>
        }
      >
        {saleQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('sales:details.loading')}</p>
        )}
        {saleQuery.error && <p className="text-sm text-danger-500">{saleQuery.error.message}</p>}

        {sale && (
          <SaleDetailsContent
            sale={sale}
            returnError={returnError}
            voidError={voidError}
            printError={printError}
          />
        )}
      </Modal>

      <ConfirmModal
        isOpen={isReturnConfirmOpen}
        onClose={() => setIsReturnConfirmOpen(false)}
        onConfirm={() => {
          void handleReturnSale();
        }}
        title={t('confirm.refund.title')}
        message={t('confirm.refund.message')}
        confirmText={t('confirm.refund.confirmText')}
        loading={returnMutation.isPending}
        variant="primary"
      />

      <ConfirmModal
        isOpen={isVoidConfirmOpen}
        onClose={() => setIsVoidConfirmOpen(false)}
        onConfirm={() => {
          void handleVoidSale();
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
