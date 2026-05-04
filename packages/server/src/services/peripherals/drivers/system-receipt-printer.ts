/**
 * ENG-060 — `system` receipt printer driver.
 *
 * The default printer driver. The actual print continues to flow
 * through the legacy `apps/desktop/src/main/index.ts:1933`
 * `ipcMain.handle('print-receipt')` path — this adapter exists to
 * identify "this site uses the system driver" so the registry can
 * dispatch `escpos` (ENG-062) as a sibling without rewriting the
 * receipt-printer.ts call site.
 *
 * The `print(job)` method returns a synchronous `{status: 'ok'}`
 * because the renderer (not this adapter) drives the actual print
 * via `window.electron.printReceipt(html)`. Future ENG-062's
 * `EscPosReceiptPrinterAdapter` will intercept here, build the
 * ESC/POS bytes, and call a new IPC channel.
 *
 * Config schema is intentionally empty `{}` — the system driver has
 * no configurable channel; it just defers to the OS print dialog.
 *
 * @module services/peripherals/drivers/system-receipt-printer
 */

import { z } from 'zod';
import type {
  ReceiptPrinterAdapter,
  PrintJob,
  PrintResult,
} from '../contracts/receipt-printer.js';
import type { TestResult } from '../types.js';

export const systemReceiptPrinterConfigSchema = z.object({}).strict();
export type SystemReceiptPrinterConfig = z.infer<typeof systemReceiptPrinterConfigSchema>;

export class SystemReceiptPrinterAdapter implements ReceiptPrinterAdapter {
  readonly kind = 'printer' as const;
  readonly driverId = 'system' as const;

  constructor(
    readonly tenantId: string,
    readonly siteId: string,
    readonly peripheralId: string,
    // Config is parsed/empty; we store it for forward compatibility
    // but never read it today.
    private readonly _config: SystemReceiptPrinterConfig
  ) {
    void this._config;
  }

  async print(_job: PrintJob): Promise<PrintResult> {
    // The renderer drives the actual print via window.electron.printReceipt.
    // This adapter's role is to confirm "the system driver is active here";
    // returning ok is the structural signal for the registry.
    return { status: 'ok' };
  }

  async testPrint(): Promise<TestResult> {
    // Non-destructive: do NOT trigger a real print dialog on the
    // operator's screen. The acknowledgement is enough — once the
    // ESC/POS driver lands (ENG-062), its testPrint will perform an
    // actual paper test.
    return {
      status: 'ok',
      message:
        'System printer registered. Use Ctrl+P or the Reimprimir flow to print a real receipt.',
    };
  }
}
