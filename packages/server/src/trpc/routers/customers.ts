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
import { createCustomer } from '../../application/customers/index.js';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import {
  auditLogs,
  clientTypes,
  commercialActivities,
  customers,
  identificationTypes,
  personTypes,
  regimeTypes,
  syncOutbox,
} from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  buildCustomerPersonalDataExport,
  getCustomerPersonalDataRecordCounts,
} from '../../services/customer-privacy/export.js';
import {
  ANONYMIZED_CUSTOMER_NAME,
  getCustomerPrivacyDispositionPreview,
} from '../../services/customer-privacy/disposition.js';
import { roundMoney } from '../../lib/money.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import { validateCustomerCatalogCode } from '../../services/customers/catalog-validation.js';
import {
  listCustomersInput,
  getCustomerInput,
  exportCustomerPersonalDataInput,
  previewCustomerPrivacyDispositionInput,
  disposeCustomerPersonalDataInput,
  createCustomerInput,
  updateCustomerInput,
  deleteCustomerInput,
  searchCustomersInput,
} from '../schemas/customers.js';

export const customersRouter = router({
  /**
   * List customers for the current tenant with pagination
   */
  list: tenantProcedure.input(listCustomersInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, isActive } = input;
    const offset = (page - 1) * perPage;

    const conditions = [
      eq(customers.tenantId, ctx.tenantId),
      eq(customers.privacyStatus, 'active'),
    ];
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
   * Export the current customer's allowlisted personal-data record.
   *
   * A mutation is deliberate even though the document is read-only: every
   * disclosure writes an audit event in the same SQLite transaction as the
   * consistent snapshot read. Only the customer id and aggregate section
   * counts reach audit metadata; the exported PII never does.
   */
  exportPersonalData: adminProcedure
    .input(exportCustomerPersonalDataInput)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(tx => {
        const document = buildCustomerPersonalDataExport(tx, ctx.tenantId, input.id);
        if (!document) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found' });
        }

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'customer.personal_data.export',
          resourceType: 'customer',
          resourceId: input.id,
          metadata: {
            schemaVersion: document.schemaVersion,
            recordCounts: getCustomerPersonalDataRecordCounts(document),
          },
        });

        return document;
      })
    ),

  /** Preview whether the privacy request can delete or must anonymize. */
  previewPersonalDataDisposition: adminProcedure
    .input(previewCustomerPrivacyDispositionInput)
    .query(({ ctx, input }) => {
      const preview = getCustomerPrivacyDispositionPreview(ctx.db, ctx.tenantId, input.id);
      if (!preview) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found' });
      }
      if (preview.customer.privacyStatus !== 'active') {
        throw new TRPCError({ code: 'CONFLICT', message: 'Customer is already anonymized' });
      }
      return {
        ...preview,
        customer: {
          id: preview.customer.id,
          name: preview.customer.name,
          version: preview.customer.version,
          privacyStatus: preview.customer.privacyStatus,
        },
      };
    }),

  /**
   * Dispose of mutable customer PII after an explicit, versioned confirmation.
   * Linked legal/financial records force anonymization; an unlinked profile is
   * physically deleted. Historical customer audit payloads are scrubbed in
   * either path before the PII-free disposition event is appended.
   */
  disposePersonalData: adminProcedure
    .input(disposeCustomerPersonalDataInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      const transactionResult = ctx.db.transaction(tx => {
        const preview = getCustomerPrivacyDispositionPreview(tx, ctx.tenantId, input.id);
        if (!preview) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found' });
        }
        if (preview.customer.privacyStatus !== 'active') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Customer is already anonymized' });
        }
        if (input.confirmation !== preview.customer.name) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Confirmation does not match the customer name',
          });
        }

        tx.update(auditLogs)
          .set({ before: null, after: null, metadata: null })
          .where(
            and(
              eq(auditLogs.tenantId, ctx.tenantId),
              eq(auditLogs.resourceType, 'customer'),
              eq(auditLogs.resourceId, input.id)
            )
          )
          .run();
        tx.delete(syncOutbox)
          .where(
            and(
              eq(syncOutbox.tenantId, ctx.tenantId),
              eq(syncOutbox.entityType, 'customers'),
              eq(syncOutbox.entityId, input.id)
            )
          )
          .run();

        if (preview.disposition === 'delete') {
          const versionedDelete = tx
            .delete(customers)
            .where(
              and(
                eq(customers.id, input.id),
                eq(customers.tenantId, ctx.tenantId),
                eq(customers.version, input.version),
                eq(customers.privacyStatus, 'active')
              )
            )
            .run() as { changes?: number };
          assertVersionedWriteApplied('customer', versionedDelete.changes ?? 0, input.version);

          writeAuditLog({
            tx,
            tenantId: ctx.tenantId,
            actorId: ctx.user!.id,
            action: 'customer.personal_data.delete',
            resourceType: 'customer',
            resourceId: input.id,
            metadata: {
              disposition: 'deleted',
              linkedRecordCounts: preview.linkedRecordCounts,
            },
          });

          return {
            publicResult: { success: true as const, id: input.id, disposition: 'deleted' as const },
            syncOperation: 'delete' as const,
            syncData: { id: input.id },
          };
        }

        const anonymizedUpdate = {
          name: ANONYMIZED_CUSTOMER_NAME,
          email: null,
          phone: null,
          address: null,
          city: null,
          state: null,
          postalCode: null,
          country: null,
          taxId: null,
          identificationTypeId: null,
          personTypeId: null,
          regimeTypeId: null,
          clientTypeId: null,
          commercialActivityId: null,
          notes: null,
          creditLimit: 0,
          creditLimitCurrencyCode: null,
          isActive: false,
          privacyStatus: 'anonymized' as const,
          privacyDisposedAt: now,
          version: input.version + 1,
          syncStatus: 'pending' as const,
          syncVersion: (preview.customer.syncVersion ?? 0) + 1,
          updatedAt: now,
        };
        const versionedUpdate = tx
          .update(customers)
          .set(anonymizedUpdate)
          .where(
            and(
              eq(customers.id, input.id),
              eq(customers.tenantId, ctx.tenantId),
              eq(customers.version, input.version),
              eq(customers.privacyStatus, 'active')
            )
          )
          .run() as { changes?: number };
        assertVersionedWriteApplied('customer', versionedUpdate.changes ?? 0, input.version);

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'customer.personal_data.anonymize',
          resourceType: 'customer',
          resourceId: input.id,
          metadata: {
            disposition: 'anonymized',
            linkedRecordCounts: preview.linkedRecordCounts,
          },
        });

        return {
          publicResult: {
            success: true as const,
            id: input.id,
            disposition: 'anonymized' as const,
          },
          syncOperation: 'update' as const,
          syncData: { id: input.id, ...anonymizedUpdate },
        };
      });

      await enqueueSync(ctx, {
        entityType: 'customers',
        entityId: input.id,
        operation: transactionResult.syncOperation,
        data: transactionResult.syncData,
      });

      return transactionResult.publicResult;
    }),

  /**
   * Create a new customer
   */
  create: managerOrAdminProcedure
    .input(createCustomerInput)
    .mutation(({ ctx, input }) => createCustomer(ctx, input)),

  /**
   * Update an existing customer
   */
  update: managerOrAdminProcedure.input(updateCustomerInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;

    const existing = await ctx.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.id, id),
          eq(customers.tenantId, ctx.tenantId),
          eq(customers.privacyStatus, 'active')
        )
      )
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
    ] = await Promise.all([
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
    if (updates.identificationTypeId !== undefined)
      updateData.identificationTypeId = identificationTypeCode;
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
            eq(customers.privacyStatus, 'active'),
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
    // vanishingly small but the multi-tenant invariant
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
   * Delete an unlinked customer (admin only).
   *
   * Kept for API compatibility. Linked records fail closed; the interactive
   * privacy flow uses previewPersonalDataDisposition + disposePersonalData.
   */
  delete: adminProcedure.input(deleteCustomerInput).mutation(async ({ ctx, input }) => {
    ctx.db.transaction(tx => {
      const preview = getCustomerPrivacyDispositionPreview(tx, ctx.tenantId, input.id);
      if (!preview) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found' });
      }
      if (preview.customer.privacyStatus !== 'active') {
        throw new TRPCError({ code: 'CONFLICT', message: 'Customer is already anonymized' });
      }
      if (preview.disposition !== 'delete') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Customer has linked records and must use the privacy disposition flow',
        });
      }

      tx.update(auditLogs)
        .set({ before: null, after: null, metadata: null })
        .where(
          and(
            eq(auditLogs.tenantId, ctx.tenantId),
            eq(auditLogs.resourceType, 'customer'),
            eq(auditLogs.resourceId, input.id)
          )
        )
        .run();
      tx.delete(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, ctx.tenantId),
            eq(syncOutbox.entityType, 'customers'),
            eq(syncOutbox.entityId, input.id)
          )
        )
        .run();
      tx.delete(customers)
        .where(and(eq(customers.id, input.id), eq(customers.tenantId, ctx.tenantId)))
        .run();
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        action: 'customer.personal_data.delete',
        resourceType: 'customer',
        resourceId: input.id,
        metadata: { disposition: 'deleted', linkedRecordCounts: preview.linkedRecordCounts },
      });
    });

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
          eq(customers.privacyStatus, 'active'),
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
