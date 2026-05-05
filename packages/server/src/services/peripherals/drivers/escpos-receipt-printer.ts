/**
 * ENG-062 — `escpos` receipt printer driver.
 *
 * Real ESC/POS device driver that sends pre-built bytes to a
 * thermal printer over USB / TCP / serial / mock channels. Sibling
 * of `SystemReceiptPrinterAdapter` (ENG-060) — both implement the
 * same `ReceiptPrinterAdapter` contract; the registry dispatches
 * by `driverId`.
 *
 * `print(job)` pipeline:
 *
 *   1. Resolve transport from `this.config` via `resolveTransport`
 *   2. Read the structured `ReceiptDocument` from `job.metadata.document`
 *      OR fall back to `job.escposBytes` when callers pre-built bytes
 *   3. `buildEscPosBytes(document, opts)` if step 2 yielded a document
 *   4. `transport.write(bytes)` — throws `EscPosTransportError` on
 *      USB unplug, paper out, TCP unreachable, etc.
 *   5. `transport.close()` (best-effort) so a fresh socket gets used
 *      next time
 *   6. On error, return `{status:'error', error: <NormalizedHardwareError>}`
 *      with the kind preserved from the transport layer
 *
 * `testPrint()` writes a short canned banner so the operator can
 * verify the device is reachable without firing a sale.
 *
 * @module services/peripherals/drivers/escpos-receipt-printer
 */

import { z } from 'zod';
import type {
  PrintJob,
  PrintResult,
  ReceiptPrinterAdapter,
} from '../contracts/receipt-printer.js';
import type { NormalizedHardwareError, TestResult } from '../types.js';
import {
  buildEscPosBytes,
  type ReceiptDocument,
  type EscPosCharset,
} from '../escpos/byte-builder.js';
import {
  EscPosTransportError,
  resolveTransport,
  type EscPosChannel,
} from '../escpos/transport.js';

// =============================================================================
// Config schema
// =============================================================================

export const escposReceiptPrinterConfigSchema = z
  .object({
    channel: z.enum(['usb', 'tcp', 'serial', 'mock']).default('tcp'),
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    vendorId: z.number().int().optional(),
    productId: z.number().int().optional(),
    devicePath: z.string().optional(),
    paperWidth: z.enum(['58mm', '80mm']).default('80mm'),
    characterSet: z.enum(['cp437', 'cp858', 'cp850', 'pc858_euro']).default('cp858'),
    /**
     * Append the drawer pulse (ESC p 0 25 250) to receipt-kind print
     * jobs so the cashier doesn't have to call `kickCashDrawer`
     * separately. The drawer must be RJ11-attached to this printer
     * for the pulse to reach it.
     */
    kickDrawerAfterReceipt: z.boolean().default(true),
    /** Override the default 3000 ms TCP connect timeout. */
    timeoutMs: z.number().int().min(100).max(30_000).optional(),
  })
  .strict();

export type EscPosReceiptPrinterConfig = z.infer<typeof escposReceiptPrinterConfigSchema>;

// =============================================================================
// Adapter
// =============================================================================

function normalizeError(err: unknown): NormalizedHardwareError {
  if (err instanceof EscPosTransportError) {
    return err.normalized;
  }
  return {
    kind: 'UNKNOWN',
    message: err instanceof Error ? err.message : String(err),
  };
}

export class EscPosReceiptPrinterAdapter implements ReceiptPrinterAdapter {
  readonly kind = 'printer' as const;
  readonly driverId = 'escpos' as const;

  constructor(
    readonly tenantId: string,
    readonly siteId: string,
    readonly peripheralId: string,
    private readonly config: EscPosReceiptPrinterConfig
  ) {}

  /**
   * Render the receipt to ESC/POS bytes (using the structured
   * `ReceiptDocument` carried via `job.metadata.document` when
   * present, or `job.escposBytes` for already-built buffers) and
   * write them to the configured transport. Errors are returned
   * as `{status:'error', error}` rather than thrown so the caller
   * can decide between fallback / retry / surface.
   */
  async print(job: PrintJob): Promise<PrintResult> {
    let bytes: Uint8Array | null = null;

    if (job.escposBytes && job.escposBytes.length > 0) {
      bytes = job.escposBytes;
    } else {
      const documentFromMeta = job.metadata?.document as ReceiptDocument | undefined;
      if (!documentFromMeta) {
        return {
          status: 'error',
          error: {
            kind: 'INVALID_CONFIG',
            message:
              'ESC/POS adapter requires job.escposBytes or job.metadata.document; neither was provided',
          },
        };
      }
      // Per-job override of the drawer pulse: callers can opt out
      // of the printer-wide `kickDrawerAfterReceipt` for documents
      // (e.g. quotation prints) where the drawer should not pop.
      const documentWithKick: ReceiptDocument = {
        ...documentFromMeta,
        kickDrawer:
          documentFromMeta.kickDrawer ??
          (job.kind === 'sale-receipt' ? this.config.kickDrawerAfterReceipt : false),
      };
      bytes = buildEscPosBytes(documentWithKick, {
        paperWidth: this.config.paperWidth,
        characterSet: this.config.characterSet as EscPosCharset,
      });
    }

    const transport = resolveTransport({
      channel: this.config.channel as EscPosChannel,
      host: this.config.host,
      port: this.config.port,
      vendorId: this.config.vendorId,
      productId: this.config.productId,
      devicePath: this.config.devicePath,
      timeoutMs: this.config.timeoutMs,
    });
    try {
      await transport.write(bytes);
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', error: normalizeError(err) };
    } finally {
      try {
        await transport.close();
      } catch {
        // Closing a transport must never throw out of the adapter;
        // we already returned the user-visible result above.
      }
    }
  }

  async testPrint(): Promise<TestResult> {
    const banner: ReceiptDocument = {
      lines: [
        { text: 'Puntovivo', align: 'center', bold: true },
        { text: 'Prueba ESC/POS', align: 'center' },
        { text: new Date().toISOString(), align: 'center' },
        { text: '' },
      ],
      cut: true,
      kickDrawer: false,
    };
    const result = await this.print({
      kind: 'sale-receipt',
      metadata: { document: banner },
    });
    if (result.status === 'ok') {
      return { status: 'ok', message: 'ESC/POS test page sent.' };
    }
    return {
      status: 'failed',
      message: result.error?.message ?? 'ESC/POS test failed',
      details: result.error
        ? { kind: result.error.kind, ...(result.error.details ?? {}) }
        : null,
    };
  }
}
