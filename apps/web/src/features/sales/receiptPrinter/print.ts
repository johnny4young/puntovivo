// Browser/Electron receipt print path ( slice 29).

import { buildSaleReceiptHtml } from './html';
import type { PrintSaleReceiptOptions, ReceiptSale } from './types';
import { openHtmlInPrintWindow } from '@/lib/printWindow';

async function openBrowserPrintWindow(receiptHtml: string): Promise<void> {
  const printWindow = openHtmlInPrintWindow(receiptHtml, {
    features: 'noopener,noreferrer,width=420,height=720',
  });

  if (!printWindow) {
    throw new Error('Unable to open the print window. Check the browser popup settings.');
  }
}

function withAutoPrint(receiptHtml: string): string {
  const script = "<script>window.addEventListener('load',function(){window.print();});</script>";
  return receiptHtml.includes('</body>')
    ? receiptHtml.replace('</body>', `${script}</body>`)
    : `${receiptHtml}${script}`;
}

/** ESC/POS failures never open a second print surface: the server may retry. */
export type ReceiptPrintOutcome = 'printed' | 'dialog-opened' | 'cancelled' | 'queued' | 'failed';

// Collapse concurrent gestures for the same receipt, while allowing a later
// deliberate reprint after the previous attempt settles.
const inFlightPrints = new Map<string, Promise<ReceiptPrintOutcome>>();

export function printSaleReceipt(
  sale: ReceiptSale,
  options: PrintSaleReceiptOptions = {}
): Promise<ReceiptPrintOutcome> {
  const key = sale.id;
  if (!key || options.shareInFlight === false) return dispatchSaleReceipt(sale, options);
  const pending = inFlightPrints.get(key);
  if (pending) return pending;
  const attempt = dispatchSaleReceipt(sale, options).finally(() => {
    inFlightPrints.delete(key);
  });
  inFlightPrints.set(key, attempt);
  return attempt;
}

async function dispatchSaleReceipt(
  sale: ReceiptSale,
  options: PrintSaleReceiptOptions = {}
): Promise<ReceiptPrintOutcome> {
  const { escposDispatcher, onEscposFailure, htmlProvider } = options;

  if (escposDispatcher) {
    let outcome;
    try {
      outcome = await escposDispatcher();
    } catch {
      // A lost response can hide a successful write or a durable retry.
      onEscposFailure?.({ error: 'DISPATCHER_REJECTED', retryQueued: false });
      return 'failed';
    }
    if (outcome.status === 'printed') return 'printed';
    if (outcome.status === 'fallback') {
      onEscposFailure?.(outcome);
      return outcome.retryQueued ? 'queued' : 'failed';
    }
    // Only an explicit System/no-ESC/POS route proceeds to HTML.
  }

  let templateHtml: string | null = null;
  if (htmlProvider) {
    try {
      templateHtml = await htmlProvider();
    } catch {
      // Keep receipt printing available during a server/read-side failure.
      // The legacy document remains an intentional upgrade fallback.
    }
  }

  if (window.electron?.printReceipt) {
    const html = templateHtml ?? (await buildSaleReceiptHtml(sale, { autoPrint: false }));
    const result = await window.electron.printReceipt(html);

    if (!result.success) {
      if (result.errorCode === 'PRINT_CANCELLED') return 'cancelled';
      throw new Error(result.error || 'Unable to print the receipt');
    }

    return 'printed';
  }

  const html = templateHtml
    ? withAutoPrint(templateHtml)
    : await buildSaleReceiptHtml(sale, { autoPrint: true });
  await openBrowserPrintWindow(html);
  return 'dialog-opened';
}
