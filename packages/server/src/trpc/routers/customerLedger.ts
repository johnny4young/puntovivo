/**
 * Customer Ledger tRPC Router — ENG-089 / ENG-208
 *
 * Read-side receivable queries remain transport-local. Manual payment and
 * adjustment writes delegate to application/customers.
 *
 * @module trpc/routers/customerLedger
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  addCustomerLedgerAdjustment,
  addCustomerLedgerPayment,
} from '../../application/customers/index.js';
import { customerLedgerEntries } from '../../db/schema.js';
import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';

const listInput = z.object({
  customerId: z.string().min(1),
  limit: z.number().int().min(1).max(500).default(50),
});

const addPaymentInput = z.object({
  customerId: z.string().min(1),
  amount: z.number().positive('amount must be positive'),
  note: z.string().optional(),
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

  getBalance: managerOrAdminProcedure
    .input(z.object({ customerId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db
        .select({
          balance: sql<number>`COALESCE(SUM(${customerLedgerEntries.amount}), 0)`.as('balance'),
        })
        .from(customerLedgerEntries)
        .where(
          and(
            eq(customerLedgerEntries.tenantId, ctx.tenantId),
            eq(customerLedgerEntries.customerId, input.customerId)
          )
        );
      return { balance: result[0]?.balance ?? 0 };
    }),

  addPayment: managerOrAdminProcedure
    .input(addPaymentInput)
    .mutation(({ ctx, input }) => addCustomerLedgerPayment({ ...ctx, user: ctx.user! }, input)),

  addAdjustment: adminProcedure
    .input(addAdjustmentInput)
    .mutation(({ ctx, input }) => addCustomerLedgerAdjustment({ ...ctx, user: ctx.user! }, input)),
});
