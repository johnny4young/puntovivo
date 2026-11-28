/** Record a customer payment as a negative ledger delta, syncing open cash drawer on cash payments. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { customerLedgerEntries, customers } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { tryRoundMoneyToSafeCents } from '../../lib/money.js';
import { getActiveCashSessionForCashier } from '../../services/cash-session.js';
import { insertAuditedCashMovement } from '../cash-sessions/recordCashMovement.js';
import type { AddCustomerLedgerPaymentInput, CustomerLedgerContext } from './types.js';

export async function addCustomerLedgerPayment(
  ctx: CustomerLedgerContext,
  input: AddCustomerLedgerPaymentInput
) {
  // Validate the customer belongs to the caller's tenant — multi-tenant
  // isolation invariant.
  const [existing] = await ctx.db
    .select({ id: customers.id, name: customers.name })
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
  const activeSession =
    input.paymentMethod === 'cash' && ctx.siteId
      ? await getActiveCashSessionForCashier(ctx.db, ctx.tenantId, ctx.siteId, ctx.user.id)
      : null;

  ctx.db.transaction(tx => {
    tx.insert(customerLedgerEntries)
      .values({
        id,
        tenantId: ctx.tenantId,
        customerId: input.customerId,
        kind: 'payment',
        // Payments are debits — store the signed delta so SUM(amount)
        // yields the running balance directly.
        amount,
        note: input.note,
        createdBy: ctx.user.id,
      })
      .run();

    if (activeSession) {
      const userNote = input.note?.trim();
      const movementNote = (userNote ? `${existing.name} · ${userNote}` : existing.name).slice(
        0,
        240
      );
      insertAuditedCashMovement(tx, {
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        session: activeSession,
        type: 'paid_in',
        amount: Math.abs(amount),
        referenceId: id,
        note: movementNote,
        metadata: { customerId: existing.id, ledgerEntryId: id },
      });
    }
  });
  return { id };
}
