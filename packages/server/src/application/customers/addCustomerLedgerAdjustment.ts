/** Record an admin reconciliation adjustment as a signed ledger delta. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { customerLedgerEntries, customers } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { tryRoundMoneyToSafeCents } from '../../lib/money.js';
import type { AddCustomerLedgerAdjustmentInput, CustomerLedgerContext } from './types.js';

export async function addCustomerLedgerAdjustment(
  ctx: CustomerLedgerContext,
  input: AddCustomerLedgerAdjustmentInput
) {
  const [existing] = await ctx.db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, ctx.tenantId)))
    .limit(1);
  if (!existing) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'CUSTOMER_NOT_FOUND' });
  }
  const amount = tryRoundMoneyToSafeCents(input.amount);
  if (amount === null || amount === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CUSTOMER_LEDGER_INVALID_AMOUNT',
      message: 'CUSTOMER_LEDGER_INVALID_AMOUNT',
    });
  }
  const id = nanoid();
  await ctx.db.insert(customerLedgerEntries).values({
    id,
    tenantId: ctx.tenantId,
    customerId: input.customerId,
    kind: 'adjustment',
    // Same reason as the payment path: the balance is a SUM of these rows.
    amount,
    note: input.note,
    createdBy: ctx.user!.id,
  });
  return { id };
}
