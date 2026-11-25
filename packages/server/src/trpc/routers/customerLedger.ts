/**
 * Customer Ledger tRPC Router —  /
 *
 * Read-side receivable queries remain transport-local. Manual payment and
 * adjustment writes delegate to application/customers.
 *
 * @module trpc/routers/customerLedger
 */

import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  addCustomerLedgerAdjustment,
  addCustomerLedgerPayment,
  addCustomerTillPayment,
  TILL_PAYMENT_NOTE_MAX,
} from '../../application/customers/index.js';
import { readCustomerBalance } from '../../services/credit-limit.js';
import { buildCashSessionContext } from './cashSessions.js';
import { customerLedgerEntries, customers } from '../../db/schema.js';
import { router } from '../init.js';
import {
  criticalCommandAdminProcedure,
  criticalCommandCashierManagerOrAdminProcedure,
  criticalCommandManagerOrAdminProcedure,
} from '../middleware/criticalCommand.js';
import { cashierManagerOrAdminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';

const listInput = z.object({
  customerId: z.string().min(1),
  limit: z.number().int().min(1).max(500).default(50),
});

const addPaymentInput = z.object({
  customerId: z.string().min(1),
  amount: z.number().positive('amount must be positive'),
  note: z.string().optional(),
});

const addTillPaymentInput = addPaymentInput.extend({
  note: z.string().trim().max(TILL_PAYMENT_NOTE_MAX).optional(),
});

const addAdjustmentInput = z.object({
  customerId: z.string().min(1),
  amount: z
    .number()
    .finite()
    .refine(value => value !== 0, 'amount must be non-zero'),
  note: z.string().trim().min(1, 'note required for adjustments'),
});

export const customerLedgerRouter = router({
  list: managerOrAdminProcedure.input(listInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select()
      .from(customerLedgerEntries)
      .where(
        and(
          eq(customerLedgerEntries.tenantId, ctx.tenantId),
          eq(customerLedgerEntries.customerId, input.customerId)
        )
      )
      .orderBy(desc(customerLedgerEntries.occurredAt))
      .limit(input.limit);
    return rows;
  }),

  // Cashiers may sell on credit, so the charge sheet must read the cupo it projects against.
  getBalance: cashierManagerOrAdminProcedure
    .input(z.object({ customerId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const customer = await ctx.db
        .select({ creditLimit: customers.creditLimit })
        .from(customers)
        .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, ctx.tenantId)))
        .get();
      return {
        balance: readCustomerBalance(ctx.db, ctx.tenantId, input.customerId),
        creditLimit: customer?.creditLimit ?? 0,
      };
    }),

  // Both writes move a customer's receivable balance and neither is
  // reversible from the UI, so they carry the command envelope: the operator's
  // repeated confirm collapses onto one idempotency key instead of paying the
  // debt down once per attempt. The role guard stays ahead of the envelope --
  // see criticalCommand.ts for why a guard behind it would be skipped on the
  // replay paths.
  addPayment: criticalCommandManagerOrAdminProcedure
    .input(addPaymentInput)
    .mutation(({ ctx, input }) => addCustomerLedgerPayment({ ...ctx, user: ctx.user! }, input)),

  // Cash a customer hands over at the register: it enters the cashier's open
  // drawer in the same transaction, so cashiers may take it.
  addTillPayment: criticalCommandCashierManagerOrAdminProcedure
    .input(addTillPaymentInput)
    .mutation(({ ctx, input }) => addCustomerTillPayment(buildCashSessionContext(ctx), input)),

  addAdjustment: criticalCommandAdminProcedure
    .input(addAdjustmentInput)
    .mutation(({ ctx, input }) => addCustomerLedgerAdjustment({ ...ctx, user: ctx.user! }, input)),
});
