/** Public types for manual customer-ledger write use-cases. */
import type { DatabaseInstance } from '../../db/index.js';

export interface CustomerLedgerContext {
  db: DatabaseInstance;
  tenantId: string;
  user: { id: string };
  siteId?: string | null | undefined;
}

/** Context shared by customer profile mutation entry points. */
export interface CustomerMutationContext {
  db: DatabaseInstance;
  tenantId: string;
  envelope?: { operationId: string; idempotencyKey?: string } | null;
  deviceId?: string | null;
}

export type CustomerLedgerPaymentMethod = 'cash' | 'card' | 'transfer';

export interface AddCustomerLedgerPaymentInput {
  customerId: string;
  amount: number;
  note?: string | undefined;
  paymentMethod?: CustomerLedgerPaymentMethod | undefined;
}

export type AddCustomerTillPaymentInput = AddCustomerLedgerPaymentInput;

export interface AddCustomerLedgerAdjustmentInput {
  customerId: string;
  amount: number;
  note: string;
}

export interface ImportOpeningCustomerBalanceInput {
  customerId: string;
  amount: number;
  note: string;
}
