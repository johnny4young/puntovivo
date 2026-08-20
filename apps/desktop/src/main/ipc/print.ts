/**
 * receipt-print IPC flow, extracted verbatim from the former
 * monolithic `main/index.ts`.
 *
 * Owns the ephemeral sandboxed print window and the bounded print
 * timeout. The session gate, HTML sanitisation at the IPC trust
 * boundary, and result mapping live in `./print-handler.ts` so node
 * tests can pin them without importing electron. Print settings
 * persistence lives in `./settings.js`.
 *
 * @module main/ipc/print
 */

import { BrowserWindow, ipcMain } from 'electron';
import { createModuleLogger } from '@puntovivo/server';
import { t } from '../i18n';
import { handlePrintReceiptRequest } from './print-handler.js';
import { getReceiptPrintSettings, type ReceiptPrintSettings } from './settings.js';

// `print` is one of the frequent-error surfaces split out of
// `electron-main` so operators can filter the stream by module=print
// without additional tagging.
const printLog = createModuleLogger('print');

// Upper bound on how long we wait for `webContents.print`'s
// completion callback. The native print path can hang indefinitely if
// the OS print dialog/spooler never returns a result (stuck driver,
// dismissed dialog on some platforms); without a ceiling the print
// promise would never settle and the ephemeral print window would leak.
// On timeout we reject (reusing the same user-visible failure copy) so
// the `finally` always runs and the window is closed.
const RECEIPT_PRINT_TIMEOUT_MS = 60_000;

async function printReceipt(receiptHtml: string, settings: ReceiptPrintSettings): Promise<void> {
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

    // Race the print callback against a hard timeout so a
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
  const handlerDeps = {
    loadSettings: getReceiptPrintSettings,
    printReceipt,
    logError: (error: unknown) => printLog.error({ err: error }, 'receipt printing failed'),
    t,
  };
  ipcMain.handle('print-receipt', (_event, receiptHtml: unknown) =>
    handlePrintReceiptRequest(receiptHtml, handlerDeps)
  );
}
