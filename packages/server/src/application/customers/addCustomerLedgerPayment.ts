/** Record a customer payment as a negative ledger delta. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { customerLedgerEntries, customers } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { tryRoundMoneyToSafeCents } from '../../lib/money.js';
import type { AddCustomerLedgerPaymentInput, CustomerLedgerContext } from './types.js';

export async function addCustomerLedgerPayment(
  ctx: CustomerLedgerContext,
  input: AddCustomerLedgerPaymentInput
) {
  // Validate the customer belongs to the caller's tenant — multi-tenant
  // isolation invariant.
  const [existing] = await ctx.db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, ctx.tenantId)))
    .limit(1);
  if (!existing) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'CUSTOMER_NOT_FOUND' });
  }
  const amount = tryRoundMoneyToSafeCents(-Math.abs(input.amount));
  if (input.amount <= 0 || amount === null || amount === 0) {
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
    kind: 'payment',
    // Payments are debits — store the signed delta so SUM(amount)
    // yields the running balance directly. Round on the way in: the input
    // schema accepts any finite number, and the balance is a SUM, so an
    // unrounded entry is not a display artifact that a later round can
    // absorb - it compounds into every balance read from then on.
    amount,
    note: input.note,
    createdBy: ctx.user!.id,
  });
  return { id };
}
