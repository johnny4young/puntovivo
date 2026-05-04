/**
 * ENG-060 — Payment terminal contract.
 *
 * Two drivers will conform to this interface:
 *   - `manual` (ENG-060): formalizes today's "cashier reads the slip
 *     and types the auth code" flow. `charge()` returns a `manual`
 *     status that the renderer recognizes and prompts the operator.
 *   - Bold / Wompi / MercadoPago (ENG-063, gated on provider sandbox
 *     + physical terminal): real Bluetooth/HTTPS adapters that drive
 *     the terminal end-to-end and persist auth/reference codes.
 *
 * @module services/peripherals/contracts/payment-terminal
 */

import type {
  BasePeripheralAdapter,
  NormalizedHardwareError,
  TestResult,
} from '../types.js';

/**
 * Discriminated union per `docs/HARDWARE-POS.md §Payment terminal §Interface`.
 * The renderer reads `status` and routes to the matching UI:
 *   - `approved` → persist auth/reference, complete sale.
 *   - `declined` → render the reason, allow retry on a different card.
 *   - `cancelled` → operator dismissed; allow another tender.
 *   - `manual` → ENG-060 fallback; render the manual entry modal.
 */
export type PaymentResult =
  | { status: 'approved'; authCode: string; reference?: string; last4?: string; brand?: string }
  | { status: 'declined'; reason: string }
  | { status: 'cancelled' }
  | { status: 'manual'; requiresOperatorInput: true; prompt?: string };

export interface VoidResult {
  status: 'ok' | 'error';
  error?: NormalizedHardwareError;
}

export interface PaymentTerminalAdapter extends BasePeripheralAdapter {
  readonly kind: 'payment_terminal';
  charge(amount: number, reference: string): Promise<PaymentResult>;
  voidTxn(txnId: string): Promise<VoidResult>;
  /** Reprint the terminal's customer-copy slip. Optional; manual driver no-ops. */
  printSlip(txnId: string): Promise<{ status: 'ok' | 'noop' | 'error'; error?: NormalizedHardwareError }>;
  testCharge(): Promise<TestResult>;
}
