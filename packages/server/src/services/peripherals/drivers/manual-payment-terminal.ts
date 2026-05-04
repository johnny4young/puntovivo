/**
 * ENG-060 — `manual` payment terminal driver.
 *
 * Formalizes today's "cashier reads the slip and types the auth
 * code" flow. `charge()` returns `{status: 'manual', requiresOperator-
 * Input: true}` so the renderer routes to its existing manual-entry
 * modal. ENG-063 will add Bold/Wompi/MercadoPago siblings that drive
 * the terminal end-to-end.
 *
 * Config:
 *   - `prompt?: string` — optional copy override for the renderer's
 *     manual-entry dialog. Defaults to the i18n key
 *     `peripherals:driver.manual.defaultPrompt` resolved client-side.
 *
 * @module services/peripherals/drivers/manual-payment-terminal
 */

import { z } from 'zod';
import type {
  PaymentResult,
  PaymentTerminalAdapter,
  VoidResult,
} from '../contracts/payment-terminal.js';
import type { TestResult } from '../types.js';

export const manualPaymentTerminalConfigSchema = z
  .object({
    prompt: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type ManualPaymentTerminalConfig = z.infer<
  typeof manualPaymentTerminalConfigSchema
>;

export class ManualPaymentTerminalAdapter implements PaymentTerminalAdapter {
  readonly kind = 'payment_terminal' as const;
  readonly driverId = 'manual' as const;

  constructor(
    readonly tenantId: string,
    readonly siteId: string,
    readonly peripheralId: string,
    private readonly config: ManualPaymentTerminalConfig
  ) {}

  async charge(_amount: number, _reference: string): Promise<PaymentResult> {
    return {
      status: 'manual',
      requiresOperatorInput: true,
      prompt: this.config.prompt,
    };
  }

  async voidTxn(_txnId: string): Promise<VoidResult> {
    // Manual terminal has no transaction registry of its own — voids
    // for the manual driver are reconciled entirely through
    // `sales.void` + a paired manual entry on the receiving system.
    return { status: 'ok' };
  }

  async printSlip(_txnId: string) {
    return { status: 'noop' as const };
  }

  async testCharge(): Promise<TestResult> {
    return {
      status: 'ok',
      message:
        'Manual entry adapter — no real terminal to test. Use the sales flow to charge.',
    };
  }
}
