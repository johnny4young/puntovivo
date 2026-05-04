/**
 * ENG-060 — Barcode scanner contract.
 *
 * USB HID keyboard-wedge scanners emit decoded codes as fast keystroke
 * bursts to the renderer; the actual capture lives in the renderer
 * (`apps/web/src/features/sales/useBarcodeScanner.ts`, planned for
 * ENG-061). This server-side contract describes configuration +
 * connectivity tests so the admin UI can list registered scanners
 * and signal status.
 *
 * No default driver ships in ENG-060 — the contract is exported so
 * ENG-061 can drop in a `usb-hid` driver without contract churn.
 *
 * @module services/peripherals/contracts/barcode-scanner
 */

import type {
  BasePeripheralAdapter,
  NormalizedHardwareError,
  TestResult,
} from '../types.js';

export interface ScannerStatus {
  connected: boolean;
  detail?: string;
  error?: NormalizedHardwareError;
}

export interface BarcodeScannerAdapter extends BasePeripheralAdapter {
  readonly kind: 'scanner';
  getStatus(): Promise<ScannerStatus>;
  /**
   * Scanner test is renderer-driven (the operator clicks Test then
   * scans a code). The server-side test method just verifies the
   * registration is structurally valid; it never blocks waiting for
   * a real scan.
   */
  testScan(timeoutMs?: number): Promise<TestResult>;
}
