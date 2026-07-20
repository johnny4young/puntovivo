/** Atomically establish a customer's first receivable balance. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { customerLedgerEntries, customers } from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import type { CustomerLedgerContext, ImportOpeningCustomerBalanceInput } from './types.js';

export function importOpeningCustomerBalance(
  ctx: CustomerLedgerContext,
  input: ImportOpeningCustomerBalanceInput
): { id?: string; status: 'created' | 'existing' } {
  const amount = roundMoney(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Opening customer balance must be a positive finite amount',
    });
  }

  return ctx.db.transaction(tx => {
    const customer = tx
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.id, input.customerId),
          eq(customers.tenantId, ctx.tenantId),
          eq(customers.isActive, true),
          eq(customers.privacyStatus, 'active')
        )
      )
      .get();
    if (!customer) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'CUSTOMER_NOT_FOUND' });
    }

    // The check and insert share one immediate SQLite transaction. Two
    // concurrent imports cannot both establish a first balance.
    const existing = tx
      .select({ id: customerLedgerEntries.id })
      .from(customerLedgerEntries)
      .where(
        and(
          eq(customerLedgerEntries.tenantId, ctx.tenantId),
          eq(customerLedgerEntries.customerId, input.customerId)
        )
      )
      .limit(1)
      .get();
    if (existing) return { status: 'existing' as const };

    const id = nanoid();
    tx.insert(customerLedgerEntries)
      .values({
        id,
        tenantId: ctx.tenantId,
        customerId: input.customerId,
        kind: 'adjustment',
        amount,
        note: input.note,
        createdBy: ctx.user.id,
      })
      .run();
    return { id, status: 'created' as const };
  });
}
