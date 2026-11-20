import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import {
  createEscposReceiptDispatcher,
  printSaleReceipt,
  type EscPosDispatchOutcome,
  type EscPosFailure,
  type HubReceiptBytesPayload,
} from '@/features/sales/receiptPrinter';
import { trpc } from '@/lib/trpc';
import type { Sale } from '@/types';

/**
 * Params for {@link useReceiptAutoPrint}.
 *
 * `autoPrintEnabled` is derived in SalesPage from the SHARED
 * `peripherals.activeForSite` query (one tRPC subscription feeds the
 * scanner + cash-drawer + auto-print consumers — ), so it
 * is passed in rather than re-queried here; re-querying would silently
 * reintroduce the duplicate-subscription the shell comment warns against.
 */
interface UseReceiptAutoPrintParams {
  /** True only when the active site's active printer config carries `autoPrintOnComplete: true`. */
  autoPrintEnabled: boolean;
}

/**
 * auto-print on sale completion.
 *
 * The active site's active printer config is read via the SAME
 * `peripherals.activeForSite` query that  already mounts for the
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
 * ESC/POS failures stop this attempt and surface a warning. Confirmed
 * server retries remain in hardware_outbox; no HTML copy is started.
 *
 * Returns `maybeAutoPrint(sale)`, invoked by the sales-mutation success
 * paths after the completion toast. Acyclic leaf: it depends only on
 * shell values + globals and never calls back into the page.
 */
export function useReceiptAutoPrint({ autoPrintEnabled }: UseReceiptAutoPrintParams) {
  const printReceipt = useReceiptPrint();
  return useCallback(
    async (sale: Sale) => {
      if (autoPrintEnabled) await printReceipt(sale, 'sales:printer.autoPrintFailed');
    },
    [autoPrintEnabled, printReceipt]
  );
}

/**
 * Prints a sale's receipt through the active site's dispatcher (ESC/POS on
 * the server or hub, else the HTML print surface). Best-effort: a failure
 * warns and never blocks the next sale.
 */
export function useReceiptPrint() {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const { currentSite } = useTenant();
  const printReceiptMutation = trpc.peripherals.printReceipt.useMutation();
  const printReceiptMutateAsync = printReceiptMutation.mutateAsync;
  const handlePrintFailure = useCallback(
    (outcome: EscPosFailure) => {
      toast.warning({
        title: t(
          outcome.retryQueued ? 'sales:printer.escposRetryQueued' : 'sales:printer.escposFailed'
        ),
      });
    },
    [t, toast]
  );
  return useCallback(
    async (sale: Sale, failureTitleKey = 'sales:printer.printFailed') => {
      if (!currentSite) return;
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
          onEscposFailure: handlePrintFailure,
          htmlProvider: async () => {
            const result = await utils.peripherals.renderReceiptHtml.fetch(
              {
                saleId: sale.id,
                siteId,
              },
              { staleTime: 0 }
            );
            return result.status === 'ready' ? result.html : null;
          },
        });
      } catch (err) {
        console.warn('[sales] receipt print failed', err);
        toast.warning({ title: t(failureTitleKey) });
      }
    },
    [currentSite, handlePrintFailure, printReceiptMutateAsync, t, toast, utils]
  );
}

/** Prints a finished sale by id, tracking the in-flight print for its button. */
export function usePrintSaleReceipt() {
  const { t } = useTranslation('sales');
  const toast = useToast();
  const utils = trpc.useUtils();
  const printReceipt = useReceiptPrint();
  const [isPrinting, setIsPrinting] = useState(false);
  const print = useCallback(
    async (saleId: string) => {
      setIsPrinting(true);
      try {
        const sale = await utils.sales.getById.fetch({ id: saleId });
        await printReceipt(sale as Sale);
      } catch {
        toast.warning({ title: t('printer.printFailed') });
      } finally {
        setIsPrinting(false);
      }
    },
    [printReceipt, t, toast, utils]
  );
  return { print, isPrinting };
}
