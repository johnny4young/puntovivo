import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, RotateCw } from 'lucide-react';
import { canRolePerformApprovalActionDirectly } from '@puntovivo/shared/manager-approval';
import { Modal, ModalButton, ConfirmModal } from '@/components/form-controls/Modal';
import { useManagerApproval } from '@/features/approvals/useManagerApproval';
import { CheckoutApprovalPanel } from './CheckoutApprovalPanel';
import { RefundConfirmOverlay } from './RefundConfirmOverlay';
import { SaleReprintModal, type ReprintReason } from './SaleReprintModal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { SaleDetailsContent } from '@/features/sales/SaleDetailsContent';
import { SaleDetailsFiscalBlock } from '@/features/sales/SaleDetailsFiscalBlock';
import {
  createEscposReceiptDispatcher,
  printSaleReceipt,
  type EscPosDispatchOutcome,
  type HubReceiptBytesPayload,
} from '@/features/sales/receiptPrinter';
import { useTenant } from '@/features/tenant/TenantProvider';
import { invalidateGroups, SERIAL_INVENTORY_INVALIDATIONS } from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatDateTime } from '@/lib/utils';

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
  const { currentSite } = useTenant();
  // +  — ESC/POS dispatch decision is collapsed into
  // `createEscposReceiptDispatcher`. In `device_local` / `site_hub`
  // it calls `peripherals.printReceipt` (server-side flush); in
  // `hub_client` it asks the hub for the bytes via
  // `peripherals.buildReceiptBytes` and pipes them through the
  // local hardware bridge (`window.electron.peripherals.dispatchLocalEscpos`).
  // Either way the dispatcher returns `printed` / `system-fallback`
  // / `fallback` so this caller stays agnostic to the runtime mode.
  const printReceiptMutation = trpc.peripherals.printReceipt.useMutation();
  // `useMutation()` returns a fresh object on every render, so depend
  // only on the stable `mutateAsync` reference — keeps the dispatcher
  // identity stable across renders without breaking exhaustive-deps.
  const printReceiptMutateAsync = printReceiptMutation.mutateAsync;
  const buildEscposDispatcher = useCallback(
    (saleIdToPrint: string): (() => Promise<EscPosDispatchOutcome>) | undefined => {
      if (!currentSite) return undefined;
      const siteId = currentSite.id;
      return createEscposReceiptDispatcher({
        serverPrint: async () => {
          const result = await printReceiptMutateAsync({
            saleId: saleIdToPrint,
            siteId,
          });
          return result as EscPosDispatchOutcome;
        },
        fetchHubReceiptBytes: async () => {
          const result = await utils.peripherals.buildReceiptBytes.fetch({
            saleId: saleIdToPrint,
            siteId,
          });
          return result as HubReceiptBytesPayload;
        },
      });
    },
    [currentSite, printReceiptMutateAsync, utils]
  );
  const handleEscposFallback = useCallback(() => {
    toast.warning({ title: t('sales:printer.escposFailedFallback') });
  }, [t, toast]);
  const [printError, setPrintError] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isReturnConfirmOpen, setIsReturnConfirmOpen] = useState(false);
  const [isVoidConfirmOpen, setIsVoidConfirmOpen] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);
  // reprint controls. Opens a small inline modal so the cashier
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
        u => u.managerApprovals.mine,
        ...SERIAL_INVENTORY_INVALIDATIONS,
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
        await printSaleReceipt(refreshed, {
          escposDispatcher: buildEscposDispatcher(refreshed.id),
          onEscposFallback: handleEscposFallback,
        });
        toast.success({ title: t('sales:reprint.toastSuccessTitle') });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t('sales:details.toast.printErrorFallback');
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
        u => u.managerApprovals.mine,
        ...SERIAL_INVENTORY_INVALIDATIONS,
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
  const isSalesRole =
    user?.role === 'admin' || user?.role === 'manager' || user?.role === 'cashier';
  const isLossPreventionPolicyRole = user?.role === 'manager' || user?.role === 'cashier';
  const shiftPolicyQueryEnabled = isOpen && !!saleId && isLossPreventionPolicyRole;
  const refundShiftPolicyQuery = trpc.lossPrevention.evaluateShiftAction.useQuery(
    { action: 'sale_refund', saleId: saleId ?? '' },
    {
      enabled: shiftPolicyQueryEnabled,
      refetchInterval: shiftPolicyQueryEnabled ? 30_000 : false,
      refetchOnWindowFocus: true,
      staleTime: 0,
    }
  );
  const voidShiftPolicyQuery = trpc.lossPrevention.evaluateShiftAction.useQuery(
    { action: 'sale_void', saleId: saleId ?? '' },
    {
      enabled: shiftPolicyQueryEnabled,
      refetchInterval: shiftPolicyQueryEnabled ? 30_000 : false,
      refetchOnWindowFocus: true,
      staleTime: 0,
    }
  );
  const isPostSaleEligible = sale?.status === 'completed' && sale.paymentStatus !== 'refunded';
  const refundBaselineNeedsApproval =
    isSalesRole &&
    isPostSaleEligible &&
    !canRolePerformApprovalActionDirectly(user?.role, 'sale_refund');
  const voidBaselineNeedsApproval =
    isSalesRole &&
    isPostSaleEligible &&
    !canRolePerformApprovalActionDirectly(user?.role, 'sale_void');
  const refundNeedsApproval =
    refundBaselineNeedsApproval || refundShiftPolicyQuery.data?.requiresApproval === true;
  const voidNeedsApproval =
    voidBaselineNeedsApproval || voidShiftPolicyQuery.data?.requiresApproval === true;
  const refundPolicyBlocked =
    shiftPolicyQueryEnabled &&
    (refundShiftPolicyQuery.isFetching || refundShiftPolicyQuery.error !== null);
  const voidPolicyBlocked =
    shiftPolicyQueryEnabled &&
    (voidShiftPolicyQuery.isFetching || voidShiftPolicyQuery.error !== null);
  const refundApproval = useManagerApproval({
    action: 'sale_refund',
    resourceType: 'sale',
    resourceId: sale?.id ?? null,
    summary: {
      label: sale?.saleNumber ?? t('sales:confirm.refund.confirmText'),
      amount: Number(sale?.total ?? 0),
      currencyCode: sale?.currencyCode ?? 'COP',
    },
    enabled: isOpen && refundNeedsApproval,
  });
  const voidApproval = useManagerApproval({
    action: 'sale_void',
    resourceType: 'sale',
    resourceId: sale?.id ?? null,
    summary: {
      label: sale?.saleNumber ?? t('sales:confirm.void.confirmText'),
      amount: Number(sale?.total ?? 0),
      currencyCode: sale?.currencyCode ?? 'COP',
    },
    enabled: isOpen && voidNeedsApproval,
  });
  const canReturnSale = isSalesRole && isPostSaleEligible;
  const canVoidSale = isSalesRole && isPostSaleEligible;
  // any non-draft sale is reprintable. The server enforces the
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
      await printSaleReceipt(sale, {
        escposDispatcher: buildEscposDispatcher(sale.id),
        onEscposFallback: handleEscposFallback,
      });
    } catch (error) {
      setPrintError(
        error instanceof Error ? error.message : t('sales:details.toast.printErrorFallback')
      );
    } finally {
      setIsPrinting(false);
    }
  };

  const handleReturnSale = async (reason?: string) => {
    if (!saleId) {
      return;
    }

    setReturnError(null);

    try {
      await returnMutation.mutateAsync({
        id: saleId,
        reason,
        ...(refundApproval.approvalRequestId
          ? { approvalRequestId: refundApproval.approvalRequestId }
          : {}),
      });
    } catch {
      // Error state is handled by the mutation callbacks.
      void refundShiftPolicyQuery.refetch();
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
      await voidMutation.mutateAsync({
        id: saleId,
        ...(voidApproval.approvalRequestId
          ? { approvalRequestId: voidApproval.approvalRequestId }
          : {}),
      });
    } catch {
      // Error state is handled by the mutation callbacks.
      void voidShiftPolicyQuery.refetch();
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
                onClick={() => {
                  if (shiftPolicyQueryEnabled) void refundShiftPolicyQuery.refetch();
                  setIsReturnConfirmOpen(true);
                }}
                variant="primary"
                disabled={isPrinting || returnMutation.isPending || voidMutation.isPending}
              >
                {t('sales:confirm.refund.confirmText')}
              </ModalButton>
            )}
            {canVoidSale && (
              <ModalButton
                onClick={() => {
                  if (shiftPolicyQueryEnabled) void voidShiftPolicyQuery.refetch();
                  setIsVoidConfirmOpen(true);
                }}
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

      <SaleReprintModal
        isOpen={isReprintModalOpen}
        onClose={() => {
          if (reprintMutation.isPending) return;
          setIsReprintModalOpen(false);
        }}
        onConfirm={() => {
          void handleReprintConfirm();
        }}
        isPending={reprintMutation.isPending}
        isPrinting={isPrinting}
        reason={reprintReason}
        reasonDetail={reprintReasonDetail}
        error={reprintError}
        onReasonChange={setReprintReason}
        onReasonDetailChange={setReprintReasonDetail}
      />

      <RefundConfirmOverlay
        isOpen={isReturnConfirmOpen}
        isPending={returnMutation.isPending}
        saleNumber={sale?.saleNumber ?? undefined}
        refundTotal={Number(sale?.total ?? 0)}
        lines={
          sale?.items?.map(item => ({
            id: item.id ?? item.productId,
            productName: item.productName ?? item.productId ?? '',
            quantity: Number(item.quantity ?? 0),
            total: Number(item.total ?? item.unitPrice ?? 0),
          })) ?? []
        }
        approvalPanel={
          refundNeedsApproval || refundPolicyBlocked ? (
            <CheckoutApprovalPanel
              {...refundApproval}
              isLoading={refundApproval.isLoading || refundShiftPolicyQuery.isFetching}
              isHashing={false}
              hasError={refundApproval.error !== null || refundShiftPolicyQuery.error !== null}
              onRequest={refundApproval.requestApproval}
              onRefresh={() =>
                void Promise.all([
                  refundApproval.refetch(),
                  ...(shiftPolicyQueryEnabled ? [refundShiftPolicyQuery.refetch()] : []),
                ])
              }
            />
          ) : undefined
        }
        confirmDisabled={
          refundPolicyBlocked || (refundNeedsApproval && !refundApproval.allApproved)
        }
        onClose={() => setIsReturnConfirmOpen(false)}
        onConfirm={reason => {
          setIsReturnConfirmOpen(false);
          void handleReturnSale(reason);
        }}
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
        confirmDisabled={voidPolicyBlocked || (voidNeedsApproval && !voidApproval.allApproved)}
        variant="danger"
      >
        {(voidNeedsApproval || voidPolicyBlocked) && (
          <CheckoutApprovalPanel
            {...voidApproval}
            isLoading={voidApproval.isLoading || voidShiftPolicyQuery.isFetching}
            isHashing={false}
            hasError={voidApproval.error !== null || voidShiftPolicyQuery.error !== null}
            onRequest={voidApproval.requestApproval}
            onRefresh={() =>
              void Promise.all([
                voidApproval.refetch(),
                ...(shiftPolicyQueryEnabled ? [voidShiftPolicyQuery.refetch()] : []),
              ])
            }
          />
        )}
      </ConfirmModal>
    </>
  );
}
