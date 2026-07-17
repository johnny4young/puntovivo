/**
 * VAT Rates tRPC Router
 *
 * CRUD and search operations for VAT rates with tenant isolation.
 *
 * Procedures:
 * - vatRates.list
 * - vatRates.getById
 * - vatRates.create
 * - vatRates.update
 * - vatRates.delete
 * - vatRates.search
 *
 * @module trpc/routers/vatRates
 */

import { TRPCError } from '@trpc/server';
import { and, eq, like } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure } from '../middleware/roles.js';
import { vatRates } from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { paginatedList } from '../lib/paginatedList.js';
import {
  createVatRateInput,
  deleteVatRateInput,
  getVatRateInput,
  listVatRatesInput,
  searchVatRatesInput,
  updateVatRateInput,
} from '../schemas/vatRates.js';

export const vatRatesRouter = router({
  list: tenantProcedure.input(listVatRatesInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, isActive } = input;

    const conditions = [eq(vatRates.tenantId, ctx.tenantId)];
    if (search) {
      conditions.push(like(vatRates.name, `%${search}%`));
    }
    if (isActive !== undefined) {
      conditions.push(eq(vatRates.isActive, isActive));
    }

    // A-22 — one predicate feeds both the page and the count.
    return paginatedList({ db: ctx.db, table: vatRates, where: and(...conditions), page, perPage });
  }),

  getById: tenantProcedure.input(getVatRateInput).query(async ({ ctx, input }) => {
    const vatRate = await ctx.db
      .select()
      .from(vatRates)
      .where(and(eq(vatRates.id, input.id), eq(vatRates.tenantId, ctx.tenantId)))
      .get();

    if (!vatRate) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'VAT rate not found' });
    }

    return vatRate;
  }),

  create: adminProcedure.input(createVatRateInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(vatRates).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      rate: input.rate,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });

    await enqueueSync(ctx, {
      entityType: 'vat_rates',
      entityId: id,
      operation: 'create',
      data: { id, ...input },
    });

    const created = await ctx.db.select().from(vatRates).where(eq(vatRates.id, id)).get();

    return created!;
  }),

  update: adminProcedure.input(updateVatRateInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;

    const existing = await ctx.db
      .select()
      .from(vatRates)
      .where(and(eq(vatRates.id, id), eq(vatRates.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'VAT rate not found' });
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.rate !== undefined) updateData.rate = updates.rate;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await ctx.db
      .update(vatRates)
      .set(updateData)
      .where(and(eq(vatRates.id, id), eq(vatRates.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'vat_rates',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
    });

    const updated = await ctx.db.select().from(vatRates).where(eq(vatRates.id, id)).get();

    return updated!;
  }),

  delete: adminProcedure.input(deleteVatRateInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(vatRates)
      .where(and(eq(vatRates.id, input.id), eq(vatRates.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'VAT rate not found' });
    }

    await ctx.db
      .delete(vatRates)
      .where(and(eq(vatRates.id, input.id), eq(vatRates.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'vat_rates',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
    });

    return { success: true, id: input.id };
  }),

  search: tenantProcedure.input(searchVatRatesInput).query(async ({ ctx, input }) => {
    const items = await ctx.db
      .select()
      .from(vatRates)
      .where(and(eq(vatRates.tenantId, ctx.tenantId), like(vatRates.name, `%${input.q}%`)))
      .limit(input.limit)
      .all();

    return { items };
  }),
});
