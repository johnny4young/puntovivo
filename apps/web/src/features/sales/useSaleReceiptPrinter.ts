import { useCallback } from 'react';
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
import type { ReceiptSale } from '@/features/sales/receiptPrinter/types';
import { trpc } from '@/lib/trpc';

/**
 * Prints one sale's receipt through the site's printer route (server flush,
 * hub bridge or system dialog). Resolves null when no site is active.
 * An ESC/POS failure surfaces a warning and never falls back to an HTML copy.
 */
export function useSaleReceiptPrinter() {
  const { t } = useTranslation('sales');
  const toast = useToast();
  const utils = trpc.useUtils();
  const { currentSite } = useTenant();
  const printReceiptMutateAsync = trpc.peripherals.printReceipt.useMutation().mutateAsync;
  const siteId = currentSite?.id ?? null;

  return useCallback(
    async (sale: ReceiptSale & { id: string }) => {
      if (!siteId) return null;
      return printSaleReceipt(sale, {
        escposDispatcher: createEscposReceiptDispatcher({
          serverPrint: async () =>
            (await printReceiptMutateAsync({ saleId: sale.id, siteId })) as EscPosDispatchOutcome,
          fetchHubReceiptBytes: async () =>
            (await utils.peripherals.buildReceiptBytes.fetch({
              saleId: sale.id,
              siteId,
            })) as HubReceiptBytesPayload,
        }),
        onEscposFailure: (outcome: EscPosFailure) => {
          toast.warning({
            title: t(outcome.retryQueued ? 'printer.escposRetryQueued' : 'printer.escposFailed'),
          });
        },
        htmlProvider: async () => {
          const result = await utils.peripherals.renderReceiptHtml.fetch(
            { saleId: sale.id, siteId },
            { staleTime: 0 }
          );
          return result.status === 'ready' ? result.html : null;
        },
      });
    },
    [printReceiptMutateAsync, siteId, t, toast, utils]
  );
}
