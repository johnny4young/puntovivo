/**
 * `wedge` USB HID keyboard scanner driver.
 *
 * USB HID keyboard-wedge scanners pretend to be USB keyboards and
 * type the decoded code into whatever has focus. The actual
 * keystroke capture lives in the renderer
 * (`apps/web/src/features/sales/useBarcodeWedgeListener.ts`); this
 * server-side adapter is a typed identifier so the registry can
 * dispatch `wedge` as a sibling driver and the admin UI can store
 * the timing config the renderer uses.
 *
 * `getStatus()` cannot probe an HID keyboard from the server side —
 * the OS routes HID events to whatever app has focus, and there is
 * no Node-side handle. We return `connected: false` with a hint
 * directing the operator to verify in the cashier UI.
 *
 * `testScan()` returns a `{status: 'ok'}` synchronously so the
 * admin's "Probar" action stamps `last_test_result='ok'` to confirm
 * the registration is structurally valid; a real scan is verified
 * by the cashier on `/sales`.
 *
 * Config schema mirrors what the renderer expects: timing windows,
 * end-of-scan signal, optional fixed prefix/suffix, and the GS1
 * decoding scheme. Defaults are tuned for the typical cheap USB HID
 * scanner (Symbol/Honeywell/Datalogic budget tier).
 *
 * @module services/peripherals/drivers/keyboard-wedge-scanner
 */

import { z } from 'zod';
import type { BarcodeScannerAdapter, ScannerStatus } from '../contracts/barcode-scanner.js';
import type { TestResult } from '../types.js';

export const wedgeScannerConfigSchema = z
  .object({
    /** Minimum buffer length to treat a burst as a scan. */
    minLength: z.number().int().min(2).max(64).default(6),
    /** Maximum buffer length before the buffer is reset. */
    maxLength: z.number().int().min(2).max(64).default(32),
    /** Maximum gap between keystrokes for the burst to count as a scan. */
    interCharGapMs: z.number().int().min(10).max(500).default(30),
    /** Which keystroke ends a scan. `gap-only` flushes on timeout. */
    endOfScan: z.enum(['enter', 'tab', 'gap-only']).default('enter'),
    /** Optional fixed prefix the scanner emits; stripped from the output. */
    prefix: z.string().optional(),
    /** Optional fixed suffix; alternative end-of-scan signal. */
    suffix: z.string().optional(),
    /** GS1 decoding scheme for prefix-2x weight/price labels. */
    gs1Scheme: z.enum(['none', 'generic', 'co', 'mx', 'cl']).default('generic'),
  })
  .refine(config => config.minLength <= config.maxLength, {
    message: 'minLength must be less than or equal to maxLength',
    path: ['minLength'],
  })
  .strict();

export type WedgeScannerConfig = z.infer<typeof wedgeScannerConfigSchema>;

export class KeyboardWedgeScannerAdapter implements BarcodeScannerAdapter {
  readonly kind = 'scanner' as const;
  readonly driverId = 'wedge' as const;

  constructor(
    readonly tenantId: string,
    readonly siteId: string,
    readonly peripheralId: string,
    private readonly _config: WedgeScannerConfig
  ) {
    void this._config;
  }

  async getStatus(): Promise<ScannerStatus> {
    // HID keyboards cannot be probed from the server. The cashier UI
    // verifies connectivity by triggering a real scan.
    return {
      connected: false,
      detail:
        'Keyboard wedge scanners cannot be probed from the server. Trigger a scan in the cashier UI to verify.',
    };
  }

  async testScan(): Promise<TestResult> {
    // Structural test only — confirms the registration is valid.
    // A real scan is verified by the cashier on /sales.
    return {
      status: 'ok',
      message: 'Keyboard wedge scanner registered. Open /sales and scan a code to verify.',
    };
  }
}
