import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, RotateCw } from 'lucide-react';
import { Modal, ModalButton, ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { SaleDetailsContent } from '@/features/sales/SaleDetailsContent';
import { SaleDetailsFiscalBlock } from '@/features/sales/SaleDetailsFiscalBlock';
import { printSaleReceipt } from '@/features/sales/receiptPrinter';
import { invalidateGroups } from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatDateTime } from '@/lib/utils';

type ReprintReason =
  | 'paper_out'
  | 'customer_request'
  | 'prior_print_error'
  | 'other';
const REPRINT_REASONS: ReprintReason[] = [
  'paper_out',
  'customer_request',
  'prior_print_error',
  'other',
];

interface SaleDetailsModalProps {
  saleId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SaleDetailsModal({ saleId, isOpen, onClose }: SaleDetailsModalProps) {
  const { t } = useTranslation(['sales', 'common', 'errors']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [printError, setPrintError] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isReturnConfirmOpen, setIsReturnConfirmOpen] = useState(false);
  const [isVoidConfirmOpen, setIsVoidConfirmOpen] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);
  // ENG-019 — reprint controls. Opens a small inline modal so the cashier
  // can pick a reason (or leave it blank) before the server-side call.
  const [isReprintModalOpen, setIsReprintModalOpen] = useState(false);
  const [reprintReason, setReprintReason] = useState<ReprintReason | ''>('');
  const [reprintReasonDetail, setReprintReasonDetail] = useState('');
  const [reprintError, setReprintError] = useState<string | null>(null);
  const returnMutation = useCriticalMutation('sales.returnSale', {
    onSuccess: async () => {
      await invalidateGroups(utils, [
        u => u.cashSessions.getActive,
        u => u.cashSessions.movements,
        u => u.cashSessions.report,
        u => u.sales.list,
        u => u.sales.summary,
        u => u.sales.getById,
        u => u.dashboard.summary,
        u => u.inventory.listMovements,
        u => u.inventory.listStock,
        u => u.products.list,
        u => u.products.search,
      ]);
      toast.success({ title: t('sales:details.toast.refundSuccessTitle') });
      setIsReturnConfirmOpen(false);
      setPrintError(null);
      setReturnError(null);
      onClose();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'sales:details.toast.refundErrorTitle',
      fallbackKey: 'sales:details.toast.refundErrorFallback',
      extra: description => setReturnError(description),
    }),
  });
  const reprintMutation = useCriticalMutation('sales.getForReprint', {
    onSuccess: async refreshed => {
      // Invalidate the modal query so the banner updates with the new
      // `reprintCount` and `lastReprintedAt`.
      await utils.sales.getById.invalidate({ id: saleId ?? '' });
      setIsReprintModalOpen(false);
      setReprintReason('');
      setReprintReasonDetail('');
      setReprintError(null);
      setIsPrinting(true);
      setPrintError(null);
      try {
        await printSaleReceipt(refreshed);
        toast.success({ title: t('sales:reprint.toastSuccessTitle') });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t('sales:details.toast.printErrorFallback');
        setPrintError(message);
        toast.error({
          title: t('sales:reprint.toastErrorTitle'),
          description: message,
        });
      } finally {
        setIsPrinting(false);
      }
    },
    // Use onErrorToast so mapped errorCodes (e.g.
    // SALE_REPRINT_ACTIVE_SESSION_REQUIRED) surface in the active
    // locale via translateServerError. Falls back to the server's
    // English message or to the generic unknown-error string when no
    // code matches.
    onError: onErrorToast(toast, t, {
      titleKey: 'sales:reprint.toastErrorTitle',
      extra: description => setReprintError(description),
    }),
  });
  const voidMutation = useCriticalMutation('sales.void', {
    onSuccess: async () => {
      await invalidateGroups(utils, [
        u => u.cashSessions.getActive,
        u => u.cashSessions.movements,
        u => u.cashSessions.report,
        u => u.sales.list,
        u => u.sales.summary,
        u => u.sales.getById,
        u => u.dashboard.summary,
        u => u.inventory.listMovements,
        u => u.inventory.listStock,
        u => u.products.list,
        u => u.products.search,
      ]);
      toast.success({ title: t('sales:details.toast.voidSuccessTitle') });
      setIsVoidConfirmOpen(false);
      setPrintError(null);
      setReturnError(null);
      setVoidError(null);
      onClose();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'sales:details.toast.voidErrorTitle',
      fallbackKey: 'sales:details.toast.voidErrorFallback',
      extra: description => setVoidError(description),
    }),
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
  // ENG-019 — any non-draft sale is reprintable. The server enforces the
  // cashier-active-session rule; UI surfaces the button for everyone and
  // shows the translated error on denial.
  const canReprintSale = !!sale && sale.status !== 'draft';
  const reprintCount = (sale as { reprintCount?: number } | undefined)?.reprintCount ?? 0;
  const lastReprintedAt =
    (sale as { lastReprintedAt?: string | null } | undefined)?.lastReprintedAt ?? null;
  const handleClose = () => {
    setPrintError(null);
    setReturnError(null);
    setVoidError(null);
    setReprintError(null);
    setIsReturnConfirmOpen(false);
    setIsVoidConfirmOpen(false);
    setIsReprintModalOpen(false);
    setReprintReason('');
    setReprintReasonDetail('');
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

  const handleReprintConfirm = async () => {
    if (!saleId) {
      return;
    }
    setReprintError(null);
    try {
      await reprintMutation.mutateAsync({
        saleId,
        reason: reprintReason || undefined,
        reasonDetail:
          reprintReason === 'other' && reprintReasonDetail.trim().length > 0
            ? reprintReasonDetail.trim()
            : undefined,
      });
    } catch {
      // Error state handled by mutation callbacks.
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
            {canReprintSale && (
              <ModalButton
                onClick={() => {
                  setReprintError(null);
                  setIsReprintModalOpen(true);
                }}
                variant="secondary"
                disabled={
                  !sale ||
                  isPrinting ||
                  returnMutation.isPending ||
                  voidMutation.isPending ||
                  reprintMutation.isPending
                }
              >
                <span className="inline-flex items-center gap-2">
                  <RotateCw className="h-4 w-4" />
                  {t('sales:reprint.actionShort')}
                </span>
              </ModalButton>
            )}
            <ModalButton onClick={handleClose}>{t('common:actions.close')}</ModalButton>
          </>
        }
      >
        {saleQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('sales:details.loading')}</p>
        )}
        {saleQuery.error && <p className="text-sm text-danger-500">{saleQuery.error.message}</p>}

        {sale && reprintCount > 0 && (
          <div
            className="mb-4 rounded-md border border-secondary-200 bg-secondary-50 px-3 py-2 text-sm text-secondary-700"
            data-testid="reprint-banner"
          >
            {lastReprintedAt
              ? t('sales:reprint.historyBannerWithoutUser', {
                  count: reprintCount,
                  when: formatDateTime(lastReprintedAt),
                })
              : t('sales:reprint.historyBannerWithoutUser', {
                  count: reprintCount,
                  when: '—',
                })}
          </div>
        )}

        {sale && (
          <SaleDetailsContent
            sale={sale}
            returnError={returnError}
            voidError={voidError}
            printError={printError}
          />
        )}

        {sale?.fiscalDocuments && sale.fiscalDocuments.length > 0 && (
          <SaleDetailsFiscalBlock
            fiscalDocuments={sale.fiscalDocuments}
            isAdmin={user?.role === 'admin'}
          />
        )}
      </Modal>

      <Modal
        isOpen={isReprintModalOpen}
        onClose={() => {
          if (reprintMutation.isPending) return;
          setIsReprintModalOpen(false);
        }}
        title={t('sales:reprint.title')}
        size="sm"
        footer={
          <>
            <ModalButton
              onClick={() => {
                if (reprintMutation.isPending) return;
                setIsReprintModalOpen(false);
              }}
              disabled={reprintMutation.isPending}
            >
              {t('sales:reprint.cancel')}
            </ModalButton>
            <ModalButton
              variant="primary"
              onClick={() => {
                void handleReprintConfirm();
              }}
              disabled={reprintMutation.isPending}
            >
              {reprintMutation.isPending || isPrinting
                ? t('sales:reprint.printing')
                : t('sales:reprint.confirm')}
            </ModalButton>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-secondary-600">
            {t('sales:reprint.description')}
          </p>
          <label className="block text-sm">
            <span className="font-medium text-secondary-800">
              {t('sales:reprint.reasonLabel')}
            </span>
            <select
              className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-1 text-sm"
              value={reprintReason}
              onChange={event => {
                const next = event.target.value as ReprintReason | '';
                setReprintReason(next);
                if (next !== 'other') {
                  setReprintReasonDetail('');
                }
              }}
              disabled={reprintMutation.isPending}
            >
              <option value="">—</option>
              {REPRINT_REASONS.map(reason => (
                <option key={reason} value={reason}>
                  {t(`sales:reprint.reasonOptions.${reason}`)}
                </option>
              ))}
            </select>
          </label>
          {reprintReason === 'other' && (
            <label className="block text-sm">
              <span className="font-medium text-secondary-800">
                {t('sales:reprint.reasonDetailLabel')}
              </span>
              <textarea
                className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-1 text-sm"
                rows={2}
                maxLength={240}
                value={reprintReasonDetail}
                onChange={event => setReprintReasonDetail(event.target.value)}
                placeholder={t('sales:reprint.reasonDetailPlaceholder')}
                disabled={reprintMutation.isPending}
              />
            </label>
          )}
          {reprintError && (
            <p className="text-sm text-danger-600" role="alert">
              {reprintError}
            </p>
          )}
        </div>
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
