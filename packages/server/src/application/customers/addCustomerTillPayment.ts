import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { customerLedgerEntries, customers } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney, tryRoundMoneyToSafeCents } from '../../lib/money.js';
import { createModuleLogger } from '../../logging/logger.js';
import { getActiveCashSessionForCashier } from '../../services/cash-session.js';
import { readCustomerBalance } from '../../services/credit-limit.js';
import { insertAuditedCashMovement } from '../cash-sessions/recordCashMovement.js';
import {
  emitCashSessionEffects,
  lookupCashSessionJournalEventId,
  type CashSessionJournalEffectInput,
} from '../cash-sessions/journal-effects.js';
import type { CashSessionContext } from '../cash-sessions/types.js';
import type { AddCustomerTillPaymentInput } from './types.js';

const fallbackLog = createModuleLogger('application/customers/addCustomerTillPayment');
export const TILL_PAYMENT_NOTE_MAX = 240;

export interface CustomerTillPaymentResult {
  ledgerEntryId: string;
  movementId: string;
  balance: number;
}

/**
 * A customer pays down their account in cash at the register. The ledger
 * payment and the drawer's cash in commit together, so the blind close
 * expects the cash the cashier took. The payment can never exceed the debt.
 */
export async function addCustomerTillPayment(
  ctx: CashSessionContext,
  input: AddCustomerTillPaymentInput
): Promise<CustomerTillPaymentResult> {
  const log = ctx.log ?? fallbackLog;
  const amount = tryRoundMoneyToSafeCents(input.amount);
  if (amount === null || amount <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CUSTOMER_LEDGER_INVALID_AMOUNT',
      message: 'CUSTOMER_LEDGER_INVALID_AMOUNT',
    });
  }
  if (!ctx.siteId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_SITE_REQUIRED',
      message: 'An active site is required before taking a payment at the register',
    });
  }

  const [customer] = await ctx.db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, ctx.tenantId)))
    .limit(1);
  if (!customer) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'CUSTOMER_NOT_FOUND' });
  }

  const session = await getActiveCashSessionForCashier(
    ctx.db,
    ctx.tenantId,
    ctx.siteId,
    ctx.user.id
  );
  if (!session) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_REQUIRED',
      message: 'An open cash session is required before taking a payment at the register',
    });
  }

  const userNote = input.note?.trim();
  const note = (userNote ? `${customer.name} · ${userNote}` : customer.name).slice(
    0,
    TILL_PAYMENT_NOTE_MAX
  );
  const ledgerEntryId = nanoid();

  const { movementId, auditLogId, balance } = ctx.db.transaction(tx => {
    const owed = readCustomerBalance(tx, ctx.tenantId, customer.id);
    if (amount > owed) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'CUSTOMER_TILL_PAYMENT_EXCEEDS_BALANCE',
        message: 'A payment at the register cannot exceed what the customer owes',
        details: { owed, amount },
      });
    }

    tx.insert(customerLedgerEntries)
      .values({
        id: ledgerEntryId,
        tenantId: ctx.tenantId,
        customerId: customer.id,
        kind: 'payment',
        amount: -amount,
        note: userNote || null,
        createdBy: ctx.user.id,
      })
      .run();

    const written = insertAuditedCashMovement(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      session,
      type: 'paid_in',
      amount,
      referenceId: ledgerEntryId,
      note,
      metadata: { customerId: customer.id, ledgerEntryId },
    });
    return { ...written, balance: roundMoney(owed - amount) };
  });

  const journalEventId = await lookupCashSessionJournalEventId(
    ctx.db,
    ctx.tenantId,
    ctx.envelope?.operationId
  );
  if (journalEventId) {
    const effects: CashSessionJournalEffectInput[] = [
      {
        kind: 'cash_movement',
        resourceType: 'cash_movements',
        resourceId: movementId,
        effectData: { sessionId: session.id, type: 'paid_in', amount },
      },
      {
        kind: 'customer_ledger_entry',
        resourceType: 'customer_ledger_entries',
        resourceId: ledgerEntryId,
        effectData: { customerId: customer.id, kind: 'payment', amount: -amount },
      },
      {
        kind: 'audit_log',
        resourceType: 'audit_logs',
        resourceId: auditLogId,
        effectData: { action: 'cash_session.movement' },
      },
    ];
    await emitCashSessionEffects(ctx.db, log, journalEventId, effects);
  }

  return { ledgerEntryId, movementId, balance };
}
