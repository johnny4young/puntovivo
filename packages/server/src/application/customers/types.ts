/** ENG-208 — Public types for manual customer-ledger write use-cases. */
import type { DatabaseInstance } from '../../db/index.js';

export interface CustomerLedgerContext {
  db: DatabaseInstance;
  tenantId: string;
  user: { id: string };
}

export interface AddCustomerLedgerPaymentInput {
  customerId: string;
  amount: number;
  note?: string | undefined;
}

export interface AddCustomerLedgerAdjustmentInput {
  customerId: string;
  amount: number;
  note: string;
}
