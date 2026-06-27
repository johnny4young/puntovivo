/**
 * Customer Ledger tRPC Router — ENG-089
 *
 * Read + write on the per-customer receivable ledger. Sale rows are
 * written by the credit-sale completion flow (ENG-090); managers
 * record manual payments / adjustments through this router.
 *
 * Procedures:
 *  - customerLedger.list        (manager+) — entries for a customer
 *  - customerLedger.getBalance  (manager+) — running balance
 *  - customerLedger.addPayment  (manager+) — debit (customer paid)
 *  - customerLedger.addAdjustment (admin)  — manual reconciliation
 *
 * @module trpc/routers/customerLedger
 */

import { TRPCError } from '@trpc/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { customerLedgerEntries, customers } from '../../db/schema.js';

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

  addPayment: managerOrAdminProcedure.input(addPaymentInput).mutation(async ({ ctx, input }) => {
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
    const id = nanoid();
    await ctx.db.insert(customerLedgerEntries).values({
      id,
      tenantId: ctx.tenantId,
      customerId: input.customerId,
      kind: 'payment',
      // Payments are debits — store the signed delta so SUM(amount)
      // yields the running balance directly.
      amount: -Math.abs(input.amount),
      note: input.note,
      createdBy: ctx.user!.id,
    });
    return { id };
  }),

  addAdjustment: adminProcedure.input(addAdjustmentInput).mutation(async ({ ctx, input }) => {
    const [existing] = await ctx.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, ctx.tenantId)))
      .limit(1);
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'CUSTOMER_NOT_FOUND' });
    }
    const id = nanoid();
    await ctx.db.insert(customerLedgerEntries).values({
      id,
      tenantId: ctx.tenantId,
      customerId: input.customerId,
      kind: 'adjustment',
      amount: input.amount,
      note: input.note,
      createdBy: ctx.user!.id,
    });
    return { id };
  }),
});
