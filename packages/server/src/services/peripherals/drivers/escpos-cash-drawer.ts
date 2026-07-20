/**
 * `escpos` cash drawer driver.
 *
 * RJ11 cash drawers open via a single 5-byte pulse on the printer
 * stream (`ESC p 0 25 250`). The drawer is physically wired into
 * the printer's RJ11 port; its config slot just holds the same
 * channel/host/port shape as the printer adapter so the same
 * transport opens for the kick.
 *
 * The two adapters (printer + drawer) typically point at the SAME
 * thermal printer hardware. We do NOT enforce that at the schema
 * level — operators with multiple printers can have a drawer on
 * each — but the JSDoc here flags the common case.
 *
 * `kick()` writes the canonical drawer-pulse bytes to the
 * configured transport. The action is idempotent: a stale retry
 * just re-pulses the relay, which is harmless on every drawer
 * model we've tested.  ships only the `escpos` driver for
 * cash drawers; 's contract leaves room for future drivers
 * (USB-HID drawers, networked relays) without contract churn.
 *
 * @module services/peripherals/drivers/escpos-cash-drawer
 */

import { z } from 'zod';
import type { CashDrawerAdapter, KickResult } from '../contracts/cash-drawer.js';
import type { NormalizedHardwareError, TestResult } from '../types.js';
import { ESCPOS_BYTES } from '../escpos/byte-builder.js';
import { EscPosTransportError, resolveTransport, type EscPosChannel } from '../escpos/transport.js';
import { addEscPosTcpTargetIssues } from '../escpos/tcp-target-policy.js';

// =============================================================================
// Config schema
// =============================================================================

/**
 * Drawer config mirrors the printer's transport shape. The drawer
 * MUST point at the same physical printer the receipts go to —
 * otherwise the pulse never reaches the RJ11 connector.
 */
export const escposCashDrawerConfigSchema = z
  .object({
    channel: z.enum(['usb', 'tcp', 'serial', 'mock']).default('tcp'),
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    vendorId: z.number().int().optional(),
    productId: z.number().int().optional(),
    devicePath: z.string().optional(),
    timeoutMs: z.number().int().min(100).max(30_000).optional(),
  })
  .strict()
  .superRefine(addEscPosTcpTargetIssues);

export type EscPosCashDrawerConfig = z.infer<typeof escposCashDrawerConfigSchema>;

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

export class EscPosCashDrawerAdapter implements CashDrawerAdapter {
  readonly kind = 'cash_drawer' as const;
  readonly driverId = 'escpos' as const;

  constructor(
    readonly tenantId: string,
    readonly siteId: string,
    readonly peripheralId: string,
    private readonly config: EscPosCashDrawerConfig
  ) {}

  async kick(): Promise<KickResult> {
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
      await transport.write(ESCPOS_BYTES.DRAWER_KICK);
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', error: normalizeError(err) };
    } finally {
      try {
        await transport.close();
      } catch {
        /* swallow — adapter result is already final */
      }
    }
  }

  async testKick(): Promise<TestResult> {
    const result = await this.kick();
    if (result.status === 'ok') {
      return { status: 'ok', message: 'Drawer pulse sent.' };
    }
    return {
      status: 'failed',
      message: result.error?.message ?? 'Drawer kick failed',
      details: result.error ? { kind: result.error.kind, ...(result.error.details ?? {}) } : null,
    };
  }
}
