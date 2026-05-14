/**
 * ENG-039b — `restaurantTables.*` tRPC namespace.
 *
 * Foundation slice for the restaurant vertical: persistent per-site
 * catalog of physical tables. ENG-039a's voice-ordering surface keeps
 * `sales.suspendedLabel` as the persistence column (no FK yet); this
 * router lets admins curate the dropdown that surface reads from.
 *
 * Procedures:
 *   - `list({siteId, includeArchived?, limit?})` — managerOrAdmin
 *   - `getById({id})` — managerOrAdmin
 *   - `create(...)` — admin (audit-logged)
 *   - `update(...)` — admin (audit-logged with before/after)
 *   - `archive({id})` — admin (audit-logged; idempotent on archived rows)
 *
 * Multi-tenant invariant: every SELECT + UPDATE scopes by
 * `ctx.tenantId`. Cross-tenant lookups collapse to `RESTAURANT_TABLE_NOT_FOUND`
 * (never FORBIDDEN — never leak existence). `siteId` is verified to
 * belong to the tenant via a local `ensureTenantSite` helper mirroring
 * the inventory router pattern.
 *
 * @module trpc/routers/restaurantTables
 */

import { and, asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { restaurantTables, sites } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import type { Context } from '../context.js';
import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import {
  archiveRestaurantTableInput,
  createRestaurantTableInput,
  getRestaurantTableByIdInput,
  listRestaurantTablesInput,
  updateRestaurantTableInput,
} from '../schemas/restaurantTables.js';

async function ensureTenantSite(
  db: Context['db'],
  tenantId: string,
  siteId: string
): Promise<void> {
  const site = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
    .get();
  if (!site) {
    // Mirror the cross-tenant collapse contract — never leak existence
    // by surfacing the siteId as a separate code from RESTAURANT_TABLE_NOT_FOUND.
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
      message: 'Site not found for this tenant',
      details: { tenantId, siteId },
    });
  }
}

function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed/i.test(message);
}

export const restaurantTablesRouter = router({
  list: managerOrAdminProcedure
    .input(listRestaurantTablesInput)
    .query(async ({ ctx, input }) => {
      // Verify the siteId is in-tenant before exposing any rows — keeps
      // the response shape uniform on cross-tenant requests.
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);

      const conditions = [
        eq(restaurantTables.tenantId, ctx.tenantId),
        eq(restaurantTables.siteId, input.siteId),
      ];
      if (!input.includeArchived) {
        conditions.push(eq(restaurantTables.isActive, true));
      }

      const rows = await ctx.db
        .select()
        .from(restaurantTables)
        .where(and(...conditions))
        .orderBy(asc(restaurantTables.name))
        .limit(input.limit)
        .all();
      return { items: rows };
    }),

  getById: managerOrAdminProcedure
    .input(getRestaurantTableByIdInput)
    .query(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(restaurantTables)
        .where(
          and(
            eq(restaurantTables.id, input.id),
            eq(restaurantTables.tenantId, ctx.tenantId)
          )
        )
        .get();
      if (!row) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
          message: `Restaurant table ${input.id} not found for this tenant`,
          details: { tenantId: ctx.tenantId, id: input.id },
        });
      }
      return row;
    }),

  create: adminProcedure
    .input(createRestaurantTableInput)
    .mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);

      const id = nanoid();
      const nowIso = new Date().toISOString();
      const row = {
        id,
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        name: input.name,
        seatCount: input.seatCount ?? null,
        area: input.area ?? null,
        notes: input.notes ?? null,
        isActive: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      try {
        await ctx.db.transaction(tx => {
          tx.insert(restaurantTables).values(row).run();
          writeAuditLog({
            tx,
            tenantId: ctx.tenantId,
            actorId: ctx.user!.id,
            action: 'restaurant_table.create',
            resourceType: 'restaurant_table',
            resourceId: id,
            before: null,
            after: row,
            metadata: { siteId: input.siteId },
          });
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_TABLE_NAME_DUPLICATE',
            message: `A restaurant table named '${input.name}' already exists for this site`,
            details: { siteId: input.siteId, name: input.name },
          });
        }
        throw err;
      }

      return row;
    }),

  update: adminProcedure
    .input(updateRestaurantTableInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const existing = await ctx.db
        .select()
        .from(restaurantTables)
        .where(
          and(
            eq(restaurantTables.id, id),
            eq(restaurantTables.tenantId, ctx.tenantId)
          )
        )
        .get();
      if (!existing) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
          message: `Restaurant table ${id} not found for this tenant`,
          details: { tenantId: ctx.tenantId, id },
        });
      }

      const nowIso = new Date().toISOString();
      const nextRow = {
        ...existing,
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.seatCount !== undefined ? { seatCount: updates.seatCount } : {}),
        ...(updates.area !== undefined ? { area: updates.area } : {}),
        ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
        ...(updates.isActive !== undefined ? { isActive: updates.isActive } : {}),
        updatedAt: nowIso,
      };

      try {
        await ctx.db.transaction(tx => {
          // Capture the better-sqlite3 result so we can detect a row
          // that was deleted between the pre-flight SELECT and the
          // UPDATE — surface NOT_FOUND instead of fabricating a
          // success projection.
          const result = tx
            .update(restaurantTables)
            .set({
              ...(updates.name !== undefined ? { name: updates.name } : {}),
              ...(updates.seatCount !== undefined ? { seatCount: updates.seatCount } : {}),
              ...(updates.area !== undefined ? { area: updates.area } : {}),
              ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
              ...(updates.isActive !== undefined ? { isActive: updates.isActive } : {}),
              updatedAt: nowIso,
            })
            .where(
              and(
                eq(restaurantTables.id, id),
                eq(restaurantTables.tenantId, ctx.tenantId)
              )
            )
            .run() as { changes?: number };
          if ((result.changes ?? 0) === 0) {
            throwServerError({
              trpcCode: 'NOT_FOUND',
              errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
              message: `Restaurant table ${id} not found for this tenant`,
              details: { tenantId: ctx.tenantId, id },
            });
          }
          writeAuditLog({
            tx,
            tenantId: ctx.tenantId,
            actorId: ctx.user!.id,
            action: 'restaurant_table.update',
            resourceType: 'restaurant_table',
            resourceId: id,
            before: existing,
            after: nextRow,
            metadata: { siteId: existing.siteId },
          });
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          const duplicateName = updates.name ?? existing.name;
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_TABLE_NAME_DUPLICATE',
            message: `A restaurant table named '${duplicateName}' already exists for this site`,
            details: { siteId: existing.siteId, name: duplicateName },
          });
        }
        throw err;
      }

      return nextRow;
    }),

  archive: adminProcedure
    .input(archiveRestaurantTableInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(restaurantTables)
        .where(
          and(
            eq(restaurantTables.id, input.id),
            eq(restaurantTables.tenantId, ctx.tenantId)
          )
        )
        .get();
      if (!existing) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
          message: `Restaurant table ${input.id} not found for this tenant`,
          details: { tenantId: ctx.tenantId, id: input.id },
        });
      }

      // Idempotent path: already archived. Return the current
      // projection without a second audit row so accidental
      // double-clicks don't pollute the audit timeline.
      if (existing.isActive === false) {
        return existing;
      }

      const nowIso = new Date().toISOString();
      const nextRow = { ...existing, isActive: false, updatedAt: nowIso };
      await ctx.db.transaction(tx => {
        tx
          .update(restaurantTables)
          .set({ isActive: false, updatedAt: nowIso })
          .where(
            and(
              eq(restaurantTables.id, input.id),
              eq(restaurantTables.tenantId, ctx.tenantId)
            )
          )
          .run();
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'restaurant_table.archive',
          resourceType: 'restaurant_table',
          resourceId: input.id,
          before: existing,
          after: nextRow,
          metadata: { siteId: existing.siteId },
        });
      });
      return nextRow;
    }),
});

export type RestaurantTablesRouter = typeof restaurantTablesRouter;
