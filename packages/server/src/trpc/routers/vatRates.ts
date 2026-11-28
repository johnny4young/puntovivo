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
import { and, eq, like, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure } from '../middleware/roles.js';
import { productTaxComponents, products, vatRates } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import type { DatabaseInstance } from '../../db/index.js';
import { paginatedList } from '../lib/paginatedList.js';
import {
  createVatRateInput,
  deleteVatRateInput,
  getVatRateInput,
  listVatRatesInput,
  searchVatRatesInput,
  updateVatRateInput,
} from '../schemas/vatRates.js';

function findTenantVatRate(db: DatabaseInstance, tenantId: string, id: string) {
  return db
    .select()
    .from(vatRates)
    .where(and(eq(vatRates.id, id), eq(vatRates.tenantId, tenantId)))
    .get();
}

function assertUniqueVatRateName(
  db: DatabaseInstance,
  tenantId: string,
  name: string,
  excludeId?: string
): void {
  const duplicate = db
    .select({ id: vatRates.id })
    .from(vatRates)
    .where(
      and(
        eq(vatRates.tenantId, tenantId),
        eq(vatRates.name, name),
        ...(excludeId ? [ne(vatRates.id, excludeId)] : [])
      )
    )
    .get();
  if (duplicate) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'VAT_RATE_NAME_DUPLICATE',
      message: 'A tax rate with that name already exists',
      details: { name },
    });
  }
}

function vatRateAuditSnapshot(row: typeof vatRates.$inferSelect) {
  return { name: row.name, rate: row.rate, kind: row.kind, isActive: row.isActive };
}

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

  create: adminProcedure.input(createVatRateInput).mutation(({ ctx, input }) => {
    const now = new Date().toISOString();
    const id = nanoid();

    return ctx.db.transaction(
      tx => {
        assertUniqueVatRateName(tx, ctx.tenantId, input.name);

        tx.insert(vatRates)
          .values({
            id,
            tenantId: ctx.tenantId,
            name: input.name,
            rate: input.rate,
            kind: input.kind,
            isActive: input.isActive,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        enqueueSyncInTransaction(
          { ...ctx, db: tx },
          { entityType: 'vat_rates', entityId: id, operation: 'create', data: { id, ...input } }
        );

        const created = findTenantVatRate(tx, ctx.tenantId, id)!;
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'vat_rate.create',
          resourceType: 'vat_rate',
          resourceId: id,
          before: null,
          after: vatRateAuditSnapshot(created),
        });
        return created;
      },
      { behavior: 'immediate' }
    );
  }),

  update: adminProcedure.input(updateVatRateInput).mutation(({ ctx, input }) => {
    const { id, ...updates } = input;
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.rate !== undefined) updateData.rate = updates.rate;
    if (updates.kind !== undefined) updateData.kind = updates.kind;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    return ctx.db.transaction(
      tx => {
        const existing = findTenantVatRate(tx, ctx.tenantId, id);
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'VAT rate not found' });
        }
        if (updates.name !== undefined && updates.name !== existing.name) {
          assertUniqueVatRateName(tx, ctx.tenantId, updates.name, id);
        }

        tx.update(vatRates)
          .set(updateData)
          .where(and(eq(vatRates.id, id), eq(vatRates.tenantId, ctx.tenantId)))
          .run();

        // The kind is denormalized onto products at pick time, so correcting
        // a rate's kind must re-stamp every product still pointing at it; the
        // rate number deliberately does not propagate.
        if (updates.kind !== undefined && updates.kind !== existing.kind) {
          tx.update(products)
            .set({ taxKind: updates.kind, updatedAt: now })
            .where(and(eq(products.vatRateId, id), eq(products.tenantId, ctx.tenantId)))
            .run();
          tx.update(productTaxComponents)
            .set({ taxKind: updates.kind, updatedAt: now })
            .where(
              and(
                eq(productTaxComponents.vatRateId, id),
                eq(productTaxComponents.tenantId, ctx.tenantId)
              )
            )
            .run();
        }

        enqueueSyncInTransaction(
          { ...ctx, db: tx },
          {
            entityType: 'vat_rates',
            entityId: id,
            operation: 'update',
            data: { id, ...updateData },
          }
        );

        const updated = findTenantVatRate(tx, ctx.tenantId, id)!;
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'vat_rate.update',
          resourceType: 'vat_rate',
          resourceId: id,
          before: vatRateAuditSnapshot(existing),
          after: vatRateAuditSnapshot(updated),
        });
        return updated;
      },
      { behavior: 'immediate' }
    );
  }),

  delete: adminProcedure.input(deleteVatRateInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(
      tx => {
        const existing = findTenantVatRate(tx, ctx.tenantId, input.id);
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'VAT rate not found' });
        }

        tx.delete(vatRates)
          .where(and(eq(vatRates.id, input.id), eq(vatRates.tenantId, ctx.tenantId)))
          .run();

        enqueueSyncInTransaction(
          { ...ctx, db: tx },
          {
            entityType: 'vat_rates',
            entityId: input.id,
            operation: 'delete',
            data: { id: input.id },
          }
        );

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'vat_rate.delete',
          resourceType: 'vat_rate',
          resourceId: input.id,
          before: vatRateAuditSnapshot(existing),
          after: null,
        });
        return { success: true, id: input.id };
      },
      { behavior: 'immediate' }
    )
  ),

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
