/**
 * ENG-178 — receipt-print IPC flow, extracted verbatim from the former
 * monolithic `main/index.ts`.
 *
 * Owns the ephemeral sandboxed print window, the DK-006 print timeout
 * and the ENG-166 HTML sanitisation at the IPC trust boundary. Print
 * settings persistence lives in `./settings.js`.
 *
 * @module main/ipc/print
 */

import { BrowserWindow, ipcMain } from 'electron';
import { createModuleLogger } from '@puntovivo/server';
import { t } from '../i18n';
import { sanitisePrintHtml } from '../print-html-sanitizer.js';
import { getReceiptPrintSettings, type ReceiptPrintSettings } from './settings.js';

// ENG-006 — `print` is one of the frequent-error surfaces split out of
// `electron-main` so operators can filter the stream by module=print
// without additional tagging.
const printLog = createModuleLogger('print');

// DK-006 — upper bound on how long we wait for `webContents.print`'s
// completion callback. The native print path can hang indefinitely if
// the OS print dialog/spooler never returns a result (stuck driver,
// dismissed dialog on some platforms); without a ceiling the print
// promise would never settle and the ephemeral print window would leak.
// On timeout we reject (reusing the same user-visible failure copy) so
// the `finally` always runs and the window is closed.
const RECEIPT_PRINT_TIMEOUT_MS = 60_000;

async function printReceipt(
  receiptHtml: string,
  settings: ReceiptPrintSettings
): Promise<void> {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml)}`);

    // DK-006 — race the print callback against a hard timeout so a
    // native print path that never invokes its callback cannot pin the
    // promise open (which would skip the `finally` and leak the window).
    let timeoutHandle: NodeJS.Timeout | undefined;
    const printDone = new Promise<void>((resolve, reject) => {
      printWindow.webContents.print(
        {
          silent: settings.silent,
          printBackground: settings.printBackground,
        },
        (success, failureReason) => {
          if (!success) {
            reject(new Error(failureReason || t('print.receiptFailed')));
            return;
          }

          resolve();
        }
      );
    });
    const printTimeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(t('print.receiptFailed')));
      }, RECEIPT_PRINT_TIMEOUT_MS);
    });

    try {
      await Promise.race([printDone, printTimeout]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
}

export function registerPrintIpc(): void {
  ipcMain.handle('print-receipt', async (_event, receiptHtml: unknown) => {
    if (typeof receiptHtml !== 'string' || receiptHtml.trim().length === 0) {
      return {
        success: false,
        error: 'A receipt document is required before printing',
      };
    }

    // ENG-166 — strip every active HTML construct (scripts, iframes,
    // event-handler attributes, non-data: image srcs) at the IPC trust
    // boundary BEFORE the HTML is loaded into the ephemeral print window.
    // The print window already runs sandbox: true, but defense-in-depth
    // makes a corrupted template harmless even if it slipped past the
    // renderer.
    const sanitisedHtml = sanitisePrintHtml(receiptHtml);
    if (sanitisedHtml.trim().length === 0) {
      return {
        success: false,
        error: 'A receipt document is required before printing',
      };
    }

    try {
      const settings = await getReceiptPrintSettings();
      await printReceipt(sanitisedHtml, settings);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Receipt printing failed';
      printLog.error({ err: error }, 'receipt printing failed');
      return {
        success: false,
        error: message,
      };
    }
  });
}
