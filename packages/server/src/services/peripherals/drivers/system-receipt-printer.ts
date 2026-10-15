/**
 * `system` receipt printer driver.
 *
 * This adapter identifies the active system route; the renderer drives
 * actual printing through the desktop print-receipt IPC or browser dialog.
 * An adapter acknowledgement therefore does not mean paper was produced.
 *
 * The system driver has no transport channel. Its opt-in completion flag
 * lets the renderer open the print dialog (or desktop silent print) after a
 * successful sale, without requiring an ESC/POS transport.
 *
 * @module services/peripherals/drivers/system-receipt-printer
 */

import { z } from 'zod';
import type { ReceiptPrinterAdapter, PrintJob, PrintResult } from '../contracts/receipt-printer.js';
import type { TestResult } from '../types.js';

export const systemReceiptPrinterConfigSchema = z
  .object({
    autoPrintOnComplete: z.boolean().default(false),
  })
  .strict();
export type SystemReceiptPrinterConfig = z.infer<typeof systemReceiptPrinterConfigSchema>;

export class SystemReceiptPrinterAdapter implements ReceiptPrinterAdapter {
  readonly kind = 'printer' as const;
  readonly driverId = 'system' as const;

  constructor(
    readonly tenantId: string,
    readonly siteId: string,
    readonly peripheralId: string,
    // Validated on register; the renderer reads the stored opt-in flag directly.
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
    // ESC/POS driver lands (), its testPrint will perform an
    // actual paper test.
    return {
      status: 'ok',
      message:
        'System printer registered. Use Ctrl+P or the Reimprimir flow to print a real receipt.',
    };
  }
}
