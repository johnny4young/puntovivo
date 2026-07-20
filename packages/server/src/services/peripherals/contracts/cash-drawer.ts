/**
 * Cash drawer contract.
 *
 * Most retail cash drawers in CO connect via RJ11 to a thermal
 * printer; the kick is a pulse on the `ESC p m t1 t2` ESC/POS
 * command.  will introduce an `escpos` driver that routes
 * the kick through the printer's stream.
 *
 * For  there is no default driver — the contract exists so
 * registration is possible but no concrete driver class is provided
 * (registering `kind='cash_drawer'` returns PERIPHERAL_DRIVER_INVALID
 * until ). The contract is exported so  can drop in
 * its driver without contract churn.
 *
 * @module services/peripherals/contracts/cash-drawer
 */

import type { BasePeripheralAdapter, NormalizedHardwareError, TestResult } from '../types.js';

export interface KickResult {
  status: 'ok' | 'error';
  error?: NormalizedHardwareError;
}

export interface CashDrawerAdapter extends BasePeripheralAdapter {
  readonly kind: 'cash_drawer';
  kick(): Promise<KickResult>;
  testKick(): Promise<TestResult>;
}
