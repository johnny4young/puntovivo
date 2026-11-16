import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import type { Sale } from '@/types';
import { useSaleReceiptPrinter } from './useSaleReceiptPrinter';

interface UseReceiptAutoPrintParams {
  /**
   * True only when the site's active printer carries `autoPrintOnComplete`.
   * Derived by the shell from the shared `peripherals.activeForSite` query;
   * re-querying here would duplicate that subscription.
   */
  autoPrintEnabled: boolean;
}

/**
 * Prints the receipt of every completed sale when the site opted in.
 * Best-effort: a print failure warns and never blocks the next sale.
 */
export function useReceiptAutoPrint({ autoPrintEnabled }: UseReceiptAutoPrintParams) {
  const { t } = useTranslation('sales');
  const toast = useToast();
  const printReceipt = useSaleReceiptPrinter();

  return useCallback(
    async (sale: Sale) => {
      if (!autoPrintEnabled) return;
      try {
        await printReceipt(sale);
      } catch (err) {
        console.warn('[sales] auto-print failed', err);
        toast.warning({ title: t('printer.autoPrintFailed') });
      }
    },
    [autoPrintEnabled, printReceipt, t, toast]
  );
}
