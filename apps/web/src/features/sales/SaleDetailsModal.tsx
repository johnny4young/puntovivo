import { useState } from 'react';
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
        utils.sales.list.invalidate(),
        utils.sales.summary.invalidate(),
        utils.sales.getById.invalidate({ id: saleId ?? '' }),
        utils.dashboard.summary.invalidate(),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
      ]);
      toast.success({ title: 'Sale refunded and stock restored' });
      setIsReturnConfirmOpen(false);
      setPrintError(null);
      setReturnError(null);
      onClose();
    },
    onError: error => {
      const message = getErrorMessage(error, 'Unable to refund the sale');
      setReturnError(message);
      toast.error({
        title: 'Unable to refund sale',
        description: message,
      });
    },
  });
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
      setReturnError(null);
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
      setPrintError(error instanceof Error ? error.message : 'Unable to print the receipt');
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
        title={sale ? `Sale ${sale.saleNumber}` : 'Sale Details'}
        size="full"
        footer={
          <>
            {canReturnSale && (
              <ModalButton
                onClick={() => setIsReturnConfirmOpen(true)}
                variant="primary"
                disabled={isPrinting || returnMutation.isPending || voidMutation.isPending}
              >
                Refund Sale
              </ModalButton>
            )}
            {canVoidSale && (
              <ModalButton
                onClick={() => setIsVoidConfirmOpen(true)}
                variant="danger"
                disabled={isPrinting || returnMutation.isPending || voidMutation.isPending}
              >
                Void Sale
              </ModalButton>
            )}
            <ModalButton
              onClick={handlePrint}
              variant="primary"
              disabled={!sale || isPrinting || returnMutation.isPending || voidMutation.isPending}
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
        title="Refund Sale"
        message="Refunding this sale will restore stock for all sale items and exclude it from completed sales revenue while preserving the historical sale record."
        confirmText="Refund Sale"
        loading={returnMutation.isPending}
        variant="primary"
      />

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
