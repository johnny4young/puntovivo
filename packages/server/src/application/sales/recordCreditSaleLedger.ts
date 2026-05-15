/**
 * recordCreditSaleLedger — ENG-090
 *
 * Writes a `customer_ledger_entries` row of kind 'sale' when a
 * completed sale is paid (in whole or in part) with the credit
 * payment method. Built as a standalone helper so the existing
 * `completeSale` transaction can call it either inline (Tier 1
 * integration) or via a post-commit hook (Tier 2 integration);
 * either way the helper writes the exact same ledger row.
 *
 * The amount stored is the unpaid portion of the sale that was
 * "Cargado a cuenta": typically the full `total` when the dominant
 * tender is `credit`, but split-tender flows can credit a partial
 * amount when the customer pays e.g. half cash + half credit.
 *
 * Inputs are kept minimal so the existing complete-sale tx context
 * can pass them without bringing the whole sale row across the
 * boundary.
 */

import { nanoid } from 'nanoid';
import { customerLedgerEntries } from '../../db/schema.js';
import type { DatabaseInstance } from '../../db/index.js';

export interface RecordCreditSaleLedgerInput {
  db: DatabaseInstance;
  tenantId: string;
  customerId: string;
  /** Reference sale id. Optional because some integration tests
   * exercise the helper before a real sale row is inserted, but
   * production paths from `completeSale` always pass it. */
  saleId?: string | null;
  /** Amount carried on credit (in tenant currency). Must be > 0; the
   * caller is expected to skip the helper when the amount is zero. */
  creditAmount: number;
  /** User id (cashier) creating the entry. Optional in the type so
   * batch tooling can pass null, but production paths always have
   * a user. */
  createdBy?: string | null;
  /** Optional note — usually populated with the receipt number so
   * the ledger row is auditable end-to-end. */
  note?: string | null;
}

export async function recordCreditSaleLedger(
  input: RecordCreditSaleLedgerInput
): Promise<{ id: string }> {
  if (!Number.isFinite(input.creditAmount) || input.creditAmount <= 0) {
    throw new Error('creditAmount must be a positive finite number');
  }
  const id = nanoid();
  await input.db.insert(customerLedgerEntries).values({
    id,
    tenantId: input.tenantId,
    customerId: input.customerId,
    kind: 'sale',
    // Sale rows are credits — store the signed delta as POSITIVE so
    // SUM(amount) yields the receivable owed by the customer.
    amount: Math.abs(input.creditAmount),
    referenceSaleId: input.saleId ?? null,
    note: input.note ?? null,
    createdBy: input.createdBy ?? null,
  });
  return { id };
}
