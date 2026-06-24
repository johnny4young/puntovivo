// Browser/Electron receipt print path (ENG-178 slice 29).

import { buildSaleReceiptHtml } from './html';
import type { PrintSaleReceiptOptions, ReceiptSale } from './types';

async function openBrowserPrintWindow(receiptHtml: string): Promise<void> {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=420,height=720');

  if (!printWindow) {
    throw new Error('Unable to open the print window. Check the browser popup settings.');
  }

  printWindow.document.open();
  printWindow.document.write(receiptHtml);
  printWindow.document.close();
}

/**
 * ENG-062 — receipt print dispatcher with ESC/POS branch + system
 * fallback. The renderer first asks the server (`printReceipt`)
 * which path to take based on the registered printer driver:
 *
 *   - `system-fallback`: no escpos peripheral registered → print
 *     via the legacy HTML path exactly like before.
 *   - `printed`: server-side ESC/POS bytes flushed; nothing else
 *     to do here.
 *   - `fallback`: ESC/POS attempt failed (USB unplug / TCP
 *     unreachable) → fall through to the legacy HTML path so the
 *     cashier never loses a receipt; the caller (SalesPage) is
 *     responsible for surfacing a translated toast about the
 *     fallback.
 *
 * `escposDispatcher` is supplied by the caller as a thin tRPC
 * mutation wrapper so this module stays unaware of the trpc client
 * shape (and the existing 10 tests in receiptPrinter.test.ts that
 * never imported tRPC continue to pass untouched).
 */
export async function printSaleReceipt(
  sale: ReceiptSale,
  options: PrintSaleReceiptOptions = {}
): Promise<void> {
  const { escposDispatcher, onEscposFallback } = options;

  // ENG-062 — server-side ESC/POS branch. When the active printer
  // is escpos and the bytes flush, we are done; otherwise we fall
  // through to the legacy HTML path that has shipped since ENG-014.
  if (escposDispatcher) {
    try {
      const outcome = await escposDispatcher();
      if (outcome.status === 'printed') return;
      if (outcome.status === 'fallback') {
        onEscposFallback?.({
          error: outcome.error,
          errorMessage: outcome.errorMessage,
        });
      }
      // For system-fallback (and the fallback case above) we
      // continue into the legacy HTML path below.
    } catch {
      // The server-side dispatcher itself rejected (network, schema,
      // etc.). Treat as fallback so the cashier still gets a
      // printed receipt via the legacy path.
      onEscposFallback?.({ error: 'DISPATCHER_REJECTED' });
    }
  }

  if (window.electron?.printReceipt) {
    const html = await buildSaleReceiptHtml(sale, { autoPrint: false });
    const result = await window.electron.printReceipt(html);

    if (!result.success) {
      throw new Error(result.error || 'Unable to print the receipt');
    }

    return;
  }

  const html = await buildSaleReceiptHtml(sale, { autoPrint: true });
  await openBrowserPrintWindow(html);
}
