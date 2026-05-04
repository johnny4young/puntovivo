/**
 * ENG-060 — Peripheral registry barrel.
 *
 * Public surface that the tRPC router and (future) renderer-side
 * consumers import from:
 *
 *   - `getPeripheralAdapter({db, tenantId, siteId, kind})` — registry
 *     resolver returning the active adapter or null.
 *   - `validatePeripheralConfig({kind, driver, config})` — pre-write
 *     hook used by `peripherals.register/update`.
 *   - `listSupportedDrivers()` — discovery for the admin driver picker.
 *   - `instantiateAdapter(row)` — used by `peripherals.test` to avoid
 *     a second SELECT.
 *   - 4 contract types (ReceiptPrinter, CashDrawer, BarcodeScanner,
 *     PaymentTerminal) + `BasePeripheralAdapter` + `NormalizedHardwareError`.
 *   - 2 default driver classes (SystemReceiptPrinterAdapter,
 *     ManualPaymentTerminalAdapter) + their config Zod schemas.
 *
 * @module services/peripherals
 */

export {
  getPeripheralAdapter,
  validatePeripheralConfig,
  listSupportedDrivers,
  instantiateAdapter,
  __setPeripheralAdapterForTest,
  __clearPeripheralAdapterOverridesForTest,
} from './registry.js';
export type {
  BasePeripheralAdapter,
  NormalizedHardwareError,
  NormalizedHardwareErrorKind,
  PeripheralAdapterContext,
  PeripheralKind,
  TestResult,
} from './types.js';
export type {
  ReceiptPrinterAdapter,
  PrintJob,
  PrintJobKind,
  PrintResult,
} from './contracts/receipt-printer.js';
export type {
  CashDrawerAdapter,
  KickResult,
} from './contracts/cash-drawer.js';
export type {
  BarcodeScannerAdapter,
  ScannerStatus,
} from './contracts/barcode-scanner.js';
export type {
  PaymentTerminalAdapter,
  PaymentResult,
  VoidResult,
} from './contracts/payment-terminal.js';
export {
  SystemReceiptPrinterAdapter,
  systemReceiptPrinterConfigSchema,
  type SystemReceiptPrinterConfig,
} from './drivers/system-receipt-printer.js';
export {
  ManualPaymentTerminalAdapter,
  manualPaymentTerminalConfigSchema,
  type ManualPaymentTerminalConfig,
} from './drivers/manual-payment-terminal.js';
