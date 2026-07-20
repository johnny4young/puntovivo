/**
 * Shared types for the peripheral adapter layer.
 *
 * `NormalizedHardwareError` mirrors the fiscal `NormalizedFiscalError`
 * shape (): a closed-set discriminator + raw provider context
 * so the Operations Center can render consistent operator copy
 * regardless of which driver surfaced the error.  /
 * extend the kind union as new failure modes appear.
 *
 * @module services/peripherals/types
 */

import type { PeripheralKind } from '../../db/schema.js';

export type { PeripheralKind };

/** Closed list of normalized hardware error kinds. */
export type NormalizedHardwareErrorKind =
  | 'DRIVER_NOT_IMPLEMENTED' //  stubbed driver (escpos / bold / wompi etc.)
  | 'DEVICE_OFFLINE' // USB unplugged, network host unreachable, Bluetooth out of range
  | 'DEVICE_TIMEOUT' // device responded slowly
  | 'INVALID_CONFIG' // driver-side validation failed
  | 'PROTOCOL_ERROR' // ESC/POS sequence rejected, malformed payload, etc.
  | 'PERMISSION_DENIED' // OS-level access blocked
  | 'UNKNOWN'; // safety fallback

export interface NormalizedHardwareError {
  kind: NormalizedHardwareErrorKind;
  message: string;
  details?: Record<string, unknown> | null;
}

/**
 * Common test-action result shape returned by every adapter's
 * `testPrint` / `testKick` / `testScan` / `testCharge` method. The
 * router stamps `last_test_result` based on `status` and persists
 * `last_test_details` from `details` for forensic inspection.
 */
export interface TestResult {
  status: 'ok' | 'failed';
  message?: string;
  details?: Record<string, unknown> | null;
}

/**
 * Adapter context the registry passes to every driver constructor.
 * Drivers MAY ignore fields they do not need (the SystemReceipt-
 * PrinterAdapter, for instance, only reads `siteId` for logging).
 */
export interface PeripheralAdapterContext {
  tenantId: string;
  siteId: string;
  /** Persisted row id; used to stamp last_tested_at via the router. */
  peripheralId: string;
  /** Driver-specific JSON config; opaque to the registry. */
  config: Record<string, unknown>;
}

/**
 * Common shape every adapter conforms to so the registry can return
 * a typed instance regardless of kind. Concrete contracts (printer /
 * cash drawer / scanner / payment terminal) extend this base.
 */
export interface BasePeripheralAdapter {
  /** Distinguishes the dispatch path; matches `peripheralKindEnum`. */
  readonly kind: PeripheralKind;
  /** Stable string identifier for the driver implementation. */
  readonly driverId: string;
  /** Tenant scope — every adapter is bound to one tenant + site. */
  readonly tenantId: string;
  readonly siteId: string;
  readonly peripheralId: string;
}
