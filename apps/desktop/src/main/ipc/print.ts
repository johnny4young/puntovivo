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

import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import * as desktopSession from '../session/desktopSession.js';
import { captureDesktopIpcSessionResult } from './session-authorization.js';
import { listSystemPrinters, selectSystemPrinter } from './system-printers.js';
import {
  createSystemPrinterPreferences,
  resolveSystemPrinter,
  SystemPrinterError,
} from '../system-printer-selection.js';
import { createModuleLogger } from '@puntovivo/server';
import { t } from '../i18n';
import {
  handlePrintReceiptRequest,
  isPrintCancellationReason,
  ReceiptPrintCancelledError,
} from './print-handler.js';
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
  const tenantId = desktopSession.requireTenantId();
  const assertSession = desktopSession.captureSessionGuard();
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    const selected = await printerPreferences().read(tenantId);
    const printers = await printWindow.webContents.getPrintersAsync();
    const selection = resolveSystemPrinter(printers, selected, settings.silent);
    assertSession();
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml)}`);

    // Race the print callback against a hard timeout so a
    // native print path that never invokes its callback cannot pin the
    // promise open (which would skip the `finally` and leak the window).
    assertSession();
    let timeoutHandle: NodeJS.Timeout | undefined;
    const printDone = new Promise<void>((resolve, reject) => {
      printWindow.webContents.print(
        {
          ...selection,
          printBackground: settings.printBackground,
          usePrinterDefaultPageSize: true,
          margins: { marginType: 'printableArea' },
        },
        (success, failureReason) => {
          if (!success) {
            if (isPrintCancellationReason(failureReason)) {
              reject(new ReceiptPrintCancelledError());
              return;
            }
            reject(new SystemPrinterError('PRINT_JOB_FAILED', 'print.systemJobFailed'));
            return;
          }

          resolve();
        }
      );
    });
    const printTimeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new SystemPrinterError('PRINT_TIMEOUT', 'print.systemTimeout'));
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

function printerPreferences() {
  return createSystemPrinterPreferences(join(app.getPath('userData'), 'printer-preferences'));
}

export function registerPrintIpc(): void {
  function depsFor(sender: Electron.WebContents) {
    return {
      session: desktopSession,
      captureSession: desktopSession.captureSessionGuard,
      list: async () =>
        (await sender.getPrintersAsync()).map(({ name, displayName }) => ({ name, displayName })),
      read: (tenantId: string) => printerPreferences().read(tenantId),
      write: (tenantId: string, name: string | null) => printerPreferences().write(tenantId, name),
    };
  }
  async function localized<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SystemPrinterError)
        throw new Error(t(error.translationKey), { cause: error });
      throw error;
    }
  }
  ipcMain.handle('list-system-printers', event =>
    captureDesktopIpcSessionResult(() => localized(() => listSystemPrinters(depsFor(event.sender))))
  );
  ipcMain.handle('select-system-printer', (event, name: unknown) =>
    captureDesktopIpcSessionResult(() =>
      localized(() => selectSystemPrinter(name, depsFor(event.sender)))
    )
  );
  const handlerDeps = {
    loadSettings: getReceiptPrintSettings,
    printReceipt,
    logError: (error: unknown) => printLog.error({ err: error }, 'receipt printing failed'),
    t,
  };
  ipcMain.handle('test-system-printer', () =>
    handlePrintReceiptRequest(
      `<html><head><style>@page{margin:0}body{font:12px monospace;max-width:48mm;overflow-wrap:anywhere}p{margin:8px 0}</style></head><body><h1>Puntovivo</h1><p>${t('print.testReceipt')}</p><p>58 mm / 80 mm</p><p>1234567890 1234567890</p></body></html>`,
      { ...handlerDeps, loadSettings: async () => ({ silent: false, printBackground: true }) }
    )
  );
  ipcMain.handle('print-receipt', (_event, receiptHtml: unknown) =>
    handlePrintReceiptRequest(receiptHtml, handlerDeps)
  );
}
