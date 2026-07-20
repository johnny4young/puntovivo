/**
 * Receipt printer contract.
 *
 * Two drivers will conform to this interface:
 * - `system` (): wraps the existing `webContents.print()` IPC
 * path. The `print(job)` method is a typed identifier; the actual
 * print continues to flow through the legacy renderer→main IPC.
 * - `escpos` (): generates ESC/POS bytes and writes them
 * over USB / TCP / serial. Includes the `ESC p m t1 t2` sequence
 * to kick the cash drawer.
 *
 * The PrintJob discriminator (`sale-receipt | fiscal-dee | quotation
 * | kitchen-ticket`) lets future drivers route different receipt
 * kinds to different output streams (e.g. kitchen tickets to a
 * second printer).
 *
 * @module services/peripherals/contracts/receipt-printer
 */

import type { BasePeripheralAdapter, NormalizedHardwareError, TestResult } from '../types.js';

export type PrintJobKind = 'sale-receipt' | 'fiscal-dee' | 'quotation' | 'kitchen-ticket';

// explicit `| undefined` on every optional field so the
// hardware-worker can compose a `PrintJob` from partial sources without
// violating `exactOptionalPropertyTypes`.
export interface PrintJob {
  kind: PrintJobKind;
  /** Server-rendered HTML body (the system driver path) — see receipt-renderer.ts. */
  html?: string | undefined;
  /** Pre-built ESC/POS byte buffer (the escpos driver path, ). */
  escposBytes?: Uint8Array | undefined;
  /** Free-form metadata (saleId, fiscalDocumentId) for logging / journal correlation. */
  metadata?: Record<string, unknown> | undefined;
}

export interface PrintResult {
  status: 'ok' | 'error';
  error?: NormalizedHardwareError | undefined;
}

export interface ReceiptPrinterAdapter extends BasePeripheralAdapter {
  readonly kind: 'printer';
  print(job: PrintJob): Promise<PrintResult>;
  /**
   * Non-destructive readiness probe. Drivers SHOULD NOT trigger a
   * physical print on this path — surface a synchronous "registered"
   * confirmation for the system driver, a status query for escpos.
   */
  testPrint(): Promise<TestResult>;
}
