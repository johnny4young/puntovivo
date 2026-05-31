/**
 * Customers tRPC Router
 *
 * CRUD and search operations for customers with tenant isolation.
 *
 * Procedures:
 * - customers.list      (tenant) - List customers with pagination
 * - customers.getById   (tenant) - Get a single customer
 * - customers.create    (tenant) - Create a new customer
 * - customers.update    (tenant) - Update a customer
 * - customers.delete    (tenant, admin) - Delete a customer
 * - customers.search    (tenant) - Search customers by name/email/phone
 *
 * @module trpc/routers/customers
 */

import { TRPCError } from '@trpc/server';
import { eq, and, sql, like, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import {
  clientTypes,
  commercialActivities,
  customers,
  identificationTypes,
  personTypes,
  regimeTypes,
} from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { roundMoney } from '../../lib/money.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import {
  listCustomersInput,
  getCustomerInput,
  createCustomerInput,
  updateCustomerInput,
  deleteCustomerInput,
  searchCustomersInput,
} from '../schemas/customers.js';

type CustomerCatalogTable =
  | typeof identificationTypes
  | typeof personTypes
  | typeof regimeTypes
  | typeof clientTypes
  | typeof commercialActivities;

async function validateCustomerCatalogCode(
  db: DatabaseInstance,
  tenantId: string,
  table: CustomerCatalogTable,
  code: string | null | undefined,
  label: string
) {
  if (!code) {
    return code ?? null;
  }

  const item = await db
    .select({ code: table.code, isActive: table.isActive })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.code, code)))
    .get();

  if (!item || item.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Selected ${label.toLowerCase()} was not found or is inactive`,
    });
  }

  return item.code;
}

export const customersRouter = router({
  /**
   * List customers for the current tenant with pagination
   */
  list: tenantProcedure.input(listCustomersInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, isActive } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(customers.tenantId, ctx.tenantId)];
    if (search) {
      conditions.push(
        or(
          like(customers.name, `%${search}%`),
          like(customers.email, `%${search}%`),
          like(customers.phone, `%${search}%`)
        )!
      );
    }
    if (isActive !== undefined) {
      conditions.push(eq(customers.isActive, isActive));
    }

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db.select().from(customers).where(where).limit(perPage).offset(offset).all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(customers)
        .where(where)
        .get(),
    ]);

    const totalItems = countResult?.count ?? 0;

    return {
      items,
      page,
      perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
    };
  }),

  /**
   * Get a single customer by ID
   */
  getById: tenantProcedure.input(getCustomerInput).query(async ({ ctx, input }) => {
    const customer = await ctx.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.id), eq(customers.tenantId, ctx.tenantId)))
      .get();

    if (!customer) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found' });
    }

    return customer;
  }),

  /**
   * Create a new customer
   */
  create: managerOrAdminProcedure.input(createCustomerInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const id = nanoid();
    const [
      identificationTypeCode,
      personTypeCode,
      regimeTypeCode,
      clientTypeCode,
      commercialActivityCode,
    ] =
      await Promise.all([
        validateCustomerCatalogCode(
          ctx.db,
          ctx.tenantId,
          identificationTypes,
          input.identificationTypeId,
          'identification type'
        ),
        validateCustomerCatalogCode(
          ctx.db,
          ctx.tenantId,
          personTypes,
          input.personTypeId,
          'person type'
        ),
        validateCustomerCatalogCode(ctx.db, ctx.tenantId, regimeTypes, input.regimeTypeId, 'regime type'),
        validateCustomerCatalogCode(ctx.db, ctx.tenantId, clientTypes, input.clientTypeId, 'client type'),
        validateCustomerCatalogCode(
          ctx.db,
          ctx.tenantId,
          commercialActivities,
          input.commercialActivityId,
          'commercial activity'
        ),
      ]);

    // ENG-176b — stamp credit_limit_currency_code only when the
    // customer actually has a credit limit. `0 = sin cupo` is the
    // legacy sentinel; setting a currency on a customer with no
    // active limit would be misleading metadata.
    const normalizedCreditLimit = roundMoney(input.creditLimit ?? 0);
    const creditLimitCurrencyCode =
      normalizedCreditLimit > 0 ? resolveTenantCurrency(ctx.db, ctx.tenantId) : null;

    await ctx.db.insert(customers).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      address: input.address,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      country: input.country,
      taxId: input.taxId,
      identificationTypeId: identificationTypeCode,
      personTypeId: personTypeCode,
      regimeTypeId: regimeTypeCode,
      clientTypeId: clientTypeCode,
      commercialActivityId: commercialActivityCode,
      notes: input.notes,
      // ENG-089 — default cupo to 0 (sin cupo) when the operator did
      // not pick a value; persistence-layer NOT NULL guards the column.
      creditLimit: normalizedCreditLimit,
      creditLimitCurrencyCode,
      isActive: input.isActive,
      syncStatus: 'pending',
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    await enqueueSync(ctx, {
      entityType: 'customers',
      entityId: id,
      operation: 'create',
      data: { id, ...input },
    });

    const created = await ctx.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)))
      .get();

    return created!;
  }),

  /**
   * Update an existing customer
   */
  update: managerOrAdminProcedure.input(updateCustomerInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;

    const existing = await ctx.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found' });
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      updatedAt: now,
      syncStatus: 'pending',
      syncVersion: (existing.syncVersion ?? 0) + 1,
      // ENG-177a — optimistic-concurrency bump (see the versioned WHERE below).
      version: input.version + 1,
    };
    const [
      identificationTypeCode,
      personTypeCode,
      regimeTypeCode,
      clientTypeCode,
      commercialActivityCode,
    ] =
      await Promise.all([
        updates.identificationTypeId !== undefined
          ? validateCustomerCatalogCode(
              ctx.db,
              ctx.tenantId,
              identificationTypes,
              updates.identificationTypeId,
              'identification type'
            )
          : Promise.resolve(undefined),
        updates.personTypeId !== undefined
          ? validateCustomerCatalogCode(
              ctx.db,
              ctx.tenantId,
              personTypes,
              updates.personTypeId,
              'person type'
            )
          : Promise.resolve(undefined),
        updates.regimeTypeId !== undefined
          ? validateCustomerCatalogCode(
              ctx.db,
              ctx.tenantId,
              regimeTypes,
              updates.regimeTypeId,
              'regime type'
            )
          : Promise.resolve(undefined),
        updates.clientTypeId !== undefined
          ? validateCustomerCatalogCode(
              ctx.db,
              ctx.tenantId,
              clientTypes,
              updates.clientTypeId,
              'client type'
            )
          : Promise.resolve(undefined),
        updates.commercialActivityId !== undefined
          ? validateCustomerCatalogCode(
              ctx.db,
              ctx.tenantId,
              commercialActivities,
              updates.commercialActivityId,
              'commercial activity'
            )
          : Promise.resolve(undefined),
      ]);

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.address !== undefined) updateData.address = updates.address;
    if (updates.city !== undefined) updateData.city = updates.city;
    if (updates.state !== undefined) updateData.state = updates.state;
    if (updates.postalCode !== undefined) updateData.postalCode = updates.postalCode;
    if (updates.country !== undefined) updateData.country = updates.country;
    if (updates.taxId !== undefined) updateData.taxId = updates.taxId;
    if (updates.identificationTypeId !== undefined) updateData.identificationTypeId = identificationTypeCode;
    if (updates.personTypeId !== undefined) updateData.personTypeId = personTypeCode;
    if (updates.regimeTypeId !== undefined) updateData.regimeTypeId = regimeTypeCode;
    if (updates.clientTypeId !== undefined) updateData.clientTypeId = clientTypeCode;
    if (updates.commercialActivityId !== undefined) {
      updateData.commercialActivityId = commercialActivityCode;
    }
    if (updates.notes !== undefined) updateData.notes = updates.notes;
    // ENG-089 — `creditLimit` can be set to 0 to remove the cupo so an
    // explicit `undefined` is the only way to skip the update.
    if (updates.creditLimit !== undefined) {
      const nextLimit = roundMoney(updates.creditLimit);
      updateData.creditLimit = nextLimit;
      // ENG-176b — keep credit_limit_currency_code in lockstep with
      // creditLimit. When the limit drops to 0 ("sin cupo") we clear
      // the currency to avoid stale metadata; when it rises from 0
      // we stamp the tenant default.
      updateData.creditLimitCurrencyCode =
        nextLimit > 0 ? resolveTenantCurrency(ctx.db, ctx.tenantId) : null;
    }
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    // ENG-007 closure — credit-limit changes must leave an audit trail.
    // Only emit when the field is explicitly in the payload AND the new
    // value differs from the prior row state; an update that touches only
    // name / phone / address never writes a credit-policy audit row.
    const priorCreditLimit = existing.creditLimit ?? 0;
    const nextCreditLimit =
      updates.creditLimit !== undefined ? roundMoney(updates.creditLimit) : priorCreditLimit;
    const creditLimitChanged =
      updates.creditLimit !== undefined && nextCreditLimit !== priorCreditLimit;

    await ctx.db.transaction(tx => {
      // ENG-177a — optimistic-concurrency guard. The version predicate makes
      // the UPDATE a no-op when another tab already saved; the throw rolls
      // back the whole transaction so no audit row is written on a stale edit.
      const versionedUpdate = tx
        .update(customers)
        .set(updateData)
        .where(
          and(
            eq(customers.id, id),
            eq(customers.tenantId, ctx.tenantId),
            eq(customers.version, input.version)
          )
        )
        .run() as { changes?: number };
      assertVersionedWriteApplied('customer', versionedUpdate.changes ?? 0, input.version);
      if (creditLimitChanged) {
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'customer.credit_limit.update',
          resourceType: 'customer',
          resourceId: id,
          before: { creditLimit: priorCreditLimit },
          after: { creditLimit: nextCreditLimit },
          metadata: {
            customerName: existing.name,
            customerEmail: existing.email ?? null,
          },
        });
      }
    });

    await enqueueSync(ctx, {
      entityType: 'customers',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
    });

    // ENG-089 collateral — mirror the tenant-scoped pattern used by
    // `getById` / the pre-write guard. The nanoid collision risk is
    // vanishingly small but the multi-tenant invariant in CLAUDE.md
    // calls for every query to scope by tenantId; the re-fetch is
    // the one spot that was inconsistent.
    const updated = await ctx.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)))
      .get();

    return updated!;
  }),

  /**
   * Delete a customer (admin only)
   */
  delete: adminProcedure.input(deleteCustomerInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.id), eq(customers.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found' });
    }

    await ctx.db
      .delete(customers)
      .where(and(eq(customers.id, input.id), eq(customers.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'customers',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
    });

    return { success: true, id: input.id };
  }),

  /**
   * Search customers by name, email, or phone
   */
  search: tenantProcedure.input(searchCustomersInput).query(async ({ ctx, input }) => {
    const items = await ctx.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, ctx.tenantId),
          or(
            like(customers.name, `%${input.q}%`),
            like(customers.email, `%${input.q}%`),
            like(customers.phone, `%${input.q}%`)
          )
        )
      )
      .limit(input.limit)
      .all();

    return { items };
  }),
});
