import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import {
  createEscposReceiptDispatcher,
  printSaleReceipt,
  type EscPosDispatchOutcome,
  type HubReceiptBytesPayload,
} from '@/features/sales/receiptPrinter';
import { trpc } from '@/lib/trpc';
import type { Sale } from '@/types';

/**
 * Params for {@link useReceiptAutoPrint}.
 *
 * `autoPrintEnabled` is derived in SalesPage from the SHARED
 * `peripherals.activeForSite` query (one tRPC subscription feeds the
 * scanner + cash-drawer + auto-print consumers — ENG-061/062/097), so it
 * is passed in rather than re-queried here; re-querying would silently
 * reintroduce the duplicate-subscription the shell comment warns against.
 */
interface UseReceiptAutoPrintParams {
  /** True only when the active site's active printer config carries `autoPrintOnComplete: true`. */
  autoPrintEnabled: boolean;
}

/**
 * ENG-097 — auto-print on sale completion.
 *
 * The active site's active printer config is read via the SAME
 * `peripherals.activeForSite` query that ENG-061 already mounts for the
 * barcode scanner + cash-drawer detection; the shell hoists that query
 * and passes the derived `autoPrintEnabled` flag in. When the active
 * printer ships with `config.autoPrintOnComplete: true`, every successful
 * sale (fresh create OR completeDraft) fires `peripherals.printReceipt`
 * through the same dispatcher the SaleDetailsModal reprint path uses, so
 * the dispatch decision (device_local / site_hub server-side vs.
 * hub_client bridge) stays in one place. Defaults to `false` so existing
 * tenants do not get surprise prints — opt-in is explicit per site at the
 * peripheral config level.
 *
 * Failures fall through the existing fallback chain (system print →
 * browser print window) inside `printSaleReceipt`. We surface a warning
 * toast when the ESC/POS path fails so the cashier knows the receipt
 * landed on a different surface; the operator can diagnose via the
 * hardware_outbox surface in Operations.
 *
 * Returns `maybeAutoPrint(sale)`, invoked by the sales-mutation success
 * paths after the completion toast. Acyclic leaf: it depends only on
 * shell values + globals and never calls back into the page.
 */
export function useReceiptAutoPrint({ autoPrintEnabled }: UseReceiptAutoPrintParams) {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const { currentSite } = useTenant();
  const printReceiptMutation = trpc.peripherals.printReceipt.useMutation();
  const printReceiptMutateAsync = printReceiptMutation.mutateAsync;
  const handleAutoPrintFallback = useCallback(() => {
    toast.warning({ title: t('sales:printer.escposFailedFallback') });
  }, [t, toast]);
  const maybeAutoPrint = useCallback(
    async (sale: Sale) => {
      if (!autoPrintEnabled || !currentSite) return;
      const siteId = currentSite.id;
      const dispatcher = createEscposReceiptDispatcher({
        serverPrint: async () => {
          const result = await printReceiptMutateAsync({
            saleId: sale.id,
            siteId,
          });
          return result as EscPosDispatchOutcome;
        },
        fetchHubReceiptBytes: async () => {
          const result = await utils.peripherals.buildReceiptBytes.fetch({
            saleId: sale.id,
            siteId,
          });
          return result as HubReceiptBytesPayload;
        },
      });
      try {
        await printSaleReceipt(sale, {
          escposDispatcher: dispatcher,
          onEscposFallback: handleAutoPrintFallback,
        });
      } catch (err) {
        // Receipt-print is best-effort post-sale — never block the
        // cashier flow. Surface a one-line warning toast and let the
        // operator reprint manually from the sale details modal.
        console.warn('[sales] auto-print failed', err);
        toast.warning({ title: t('sales:printer.autoPrintFailed') });
      }
    },
    [
      autoPrintEnabled,
      currentSite,
      handleAutoPrintFallback,
      printReceiptMutateAsync,
      t,
      toast,
      utils,
    ]
  );

  return maybeAutoPrint;
}
