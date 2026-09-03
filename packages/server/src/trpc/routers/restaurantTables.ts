/**
 * `restaurantTables.*` tRPC namespace.
 *
 * Persistent per-site catalog of physical tables. Operational reads are
 * available to cashiers, managers and admins; catalog mutations remain
 * admin-only. Normalized services/checks own occupancy while the plural draft
 * projection remains compatible with legacy suspended sales.
 *
 * Procedures:
 * - `list({siteId, includeArchived?, limit?})` — cashier/manager/admin
 * - `getById({id})` — cashier/manager/admin
 * - `create(...)` — admin (audit-logged)
 * - `update(...)` — admin (audit-logged with before/after)
 * - `archive({id})` — admin (audit-logged; idempotent on archived rows)
 *
 * Multi-tenant invariant: every SELECT + UPDATE scopes by
 * `ctx.tenantId`. Cross-tenant lookups collapse to `RESTAURANT_TABLE_NOT_FOUND`
 * (never FORBIDDEN — never leak existence). `siteId` is verified to
 * belong to the tenant via the shared `ensureTenantSite` guard.
 *
 * @module trpc/routers/restaurantTables
 */

import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';
import { TRPCError } from '@trpc/server';
import { cashSessions, restaurantServices, restaurantTables, sales } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { router } from '../init.js';
import { adminProcedure, cashierManagerOrAdminProcedure } from '../middleware/roles.js';
import { createModuleGuard } from '../middleware/modules.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import { RESTAURANT_SERVICE_LIMITS } from '../../application/restaurant/service-lifecycle.js';
import {
  archiveRestaurantTableInput,
  createRestaurantTableInput,
  getRestaurantTableByIdInput,
  listRestaurantTablesInput,
  MAX_ACTIVE_RESTAURANT_TABLES_PER_SITE,
  updateRestaurantTableInput,
} from '../schemas/restaurantTables.js';

// the table map is a dine-in surface. A counter-only tenant
// must not reach it over the wire either, so both role tiers compose
// the module guard (same pattern as kds.ts).
const tableReadProcedure = cashierManagerOrAdminProcedure.use(createModuleGuard('dine-in'));
const tableAdminProcedure = adminProcedure.use(createModuleGuard('dine-in'));

async function ensureRestaurantSite(
  db: Parameters<typeof ensureTenantSite>[0],
  tenantId: string,
  siteId: string
): Promise<void> {
  try {
    await ensureTenantSite(db, tenantId, siteId);
  } catch (error) {
    // Preserve infrastructure and SQLite failures. Only translate the shared
    // guard's deliberate existence-hiding NOT_FOUND into this namespace's
    // stable error code.
    if (!(error instanceof TRPCError) || error.code !== 'NOT_FOUND') {
      throw error;
    }
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

function literalContains(column: AnySQLiteColumn, value: string) {
  // Table search is a literal substring match, not a caller-controlled SQL
  // pattern. Escape SQLite LIKE metacharacters so %, _ and ! remain searchable.
  const escaped = value.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');
  return sql`${column} LIKE ${`%${escaped}%`} ESCAPE '!'`;
}

function assertActiveTableCapacity(
  db: Parameters<typeof ensureTenantSite>[0],
  tenantId: string,
  siteId: string
): void {
  const activeCount =
    db
      .select({ value: count() })
      .from(restaurantTables)
      .where(
        and(
          eq(restaurantTables.tenantId, tenantId),
          eq(restaurantTables.siteId, siteId),
          eq(restaurantTables.isActive, true)
        )
      )
      .get()?.value ?? 0;
  if (activeCount >= MAX_ACTIVE_RESTAURANT_TABLES_PER_SITE) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_TABLE_LIMIT_REACHED',
      message: 'The site has reached its active restaurant table limit',
      details: {
        siteId,
        maximumActiveTables: MAX_ACTIVE_RESTAURANT_TABLES_PER_SITE,
      },
    });
  }
}

export const restaurantTablesRouter = router({
  list: tableReadProcedure.input(listRestaurantTablesInput).query(async ({ ctx, input }) => {
    // Verify the siteId is in-tenant before exposing any rows — keeps
    // the response shape uniform on cross-tenant requests.
    await ensureRestaurantSite(ctx.db, ctx.tenantId, input.siteId);

    const conditions = [
      eq(restaurantTables.tenantId, ctx.tenantId),
      eq(restaurantTables.siteId, input.siteId),
    ];
    if (!input.includeArchived) {
      conditions.push(eq(restaurantTables.isActive, true));
    }
    if (input.search) {
      conditions.push(literalContains(restaurantTables.name, input.search));
    }

    return ctx.db.transaction(tx => {
      const where = and(...conditions);
      const totalItems =
        tx.select({ value: count() }).from(restaurantTables).where(where).get()?.value ?? 0;
      const rows = tx
        .select()
        .from(restaurantTables)
        .where(where)
        .orderBy(asc(restaurantTables.name), asc(restaurantTables.id))
        .limit(input.limit)
        .offset(input.offset)
        .all();
      return {
        items: rows,
        offset: input.offset,
        limit: input.limit,
        totalItems,
        hasMore: input.offset + rows.length < totalItems,
      };
    });
  }),

  /**
   * Catalog rows for a site, each augmented with the open
   * draft sales that currently occupy it. A resumed draft remains an open
   * restaurant check, so occupancy follows `status='draft'` rather than the
   * cashier-only `suspended_at` workflow flag.
   *
   * Multi-tenant invariant: the draft lookup pins
   * `sales.tenant_id = ctx.tenantId`, so a sale belonging to a
   * different tenant can never surface as the open draft for this
   * row. Tested by `restaurant-tables.test.ts`.
   */
  listWithDraftStatus: tableReadProcedure
    .input(listRestaurantTablesInput)
    .query(async ({ ctx, input }) => {
      await ensureRestaurantSite(ctx.db, ctx.tenantId, input.siteId);
      return ctx.db.transaction(tx => {
        const conditions = [
          eq(restaurantTables.tenantId, ctx.tenantId),
          eq(restaurantTables.siteId, input.siteId),
        ];
        if (!input.includeArchived) {
          conditions.push(eq(restaurantTables.isActive, true));
        }
        if (input.search) {
          conditions.push(literalContains(restaurantTables.name, input.search));
        }
        const where = and(...conditions);
        const totalItems =
          tx.select({ value: count() }).from(restaurantTables).where(where).get()?.value ?? 0;

        const tableRows = tx
          .select({
            id: restaurantTables.id,
            tenantId: restaurantTables.tenantId,
            siteId: restaurantTables.siteId,
            name: restaurantTables.name,
            seatCount: restaurantTables.seatCount,
            area: restaurantTables.area,
            notes: restaurantTables.notes,
            isActive: restaurantTables.isActive,
            createdAt: restaurantTables.createdAt,
            updatedAt: restaurantTables.updatedAt,
          })
          .from(restaurantTables)
          .where(where)
          .orderBy(asc(restaurantTables.name), asc(restaurantTables.id))
          .limit(input.limit)
          .offset(input.offset)
          .all();

        if (tableRows.length === 0) {
          return {
            items: [],
            offset: input.offset,
            limit: input.limit,
            totalItems,
            hasMore: false,
          };
        }

        const projectionLimit = tableRows.length * RESTAURANT_SERVICE_LIMITS.openChecks;
        const draftRows = tx
          .select({
            tableId: sales.tableId,
            saleId: sales.id,
            saleNumber: sales.saleNumber,
            suspendedAt: sales.suspendedAt,
            suspendedBy: sales.suspendedBy,
            total: sales.total,
            cashSessionId: sales.cashSessionId,
            cashSessionSiteId: cashSessions.siteId,
          })
          .from(sales)
          .leftJoin(
            cashSessions,
            and(eq(cashSessions.id, sales.cashSessionId), eq(cashSessions.tenantId, ctx.tenantId))
          )
          .where(
            and(
              eq(sales.tenantId, ctx.tenantId),
              inArray(
                sales.tableId,
                tableRows.map(row => row.id)
              ),
              eq(sales.status, 'draft')
            )
          )
          .orderBy(desc(sales.suspendedAt), desc(sales.createdAt), desc(sales.id))
          .limit(projectionLimit + 1)
          .all();
        if (draftRows.length > projectionLimit) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
            message: 'Restaurant table occupancy exceeds its safe projection limit',
          });
        }

        const tableById = new Map(tableRows.map(row => [row.id, row]));
        const openDraftsByTableId = new Map<string, Array<(typeof draftRows)[number]>>();
        for (const draft of draftRows) {
          if (!draft.tableId) continue;
          const table = tableById.get(draft.tableId);
          if (
            !table ||
            (draft.cashSessionId !== null && draft.cashSessionSiteId !== table.siteId)
          ) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
              message: 'Restaurant draft site does not match its physical table',
            });
          }
          const drafts = openDraftsByTableId.get(draft.tableId) ?? [];
          drafts.push(draft);
          if (drafts.length > RESTAURANT_SERVICE_LIMITS.openChecks) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
              message: 'A restaurant table has too many simultaneous open checks',
              details: {
                tableId: draft.tableId,
                maximumOpenChecks: RESTAURANT_SERVICE_LIMITS.openChecks,
              },
            });
          }
          openDraftsByTableId.set(draft.tableId, drafts);
        }

        return {
          items: tableRows.map(row => {
            const openDrafts = (openDraftsByTableId.get(row.id) ?? []).map(openDraft => ({
              saleId: openDraft.saleId,
              saleNumber: openDraft.saleNumber,
              suspendedAt: openDraft.suspendedAt,
              suspendedBy: openDraft.suspendedBy,
              total: openDraft.total ?? 0,
            }));
            const openDraft = openDrafts[0];
            return {
              id: row.id,
              tenantId: row.tenantId,
              siteId: row.siteId,
              name: row.name,
              seatCount: row.seatCount,
              area: row.area,
              notes: row.notes,
              isActive: row.isActive,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              // Additive plural projection is authoritative. Keep the singular
              // newest draft for older clients until they migrate.
              openDrafts,
              openDraft: openDraft ?? null,
            };
          }),
          offset: input.offset,
          limit: input.limit,
          totalItems,
          hasMore: input.offset + tableRows.length < totalItems,
        };
      });
    }),

  getById: tableReadProcedure.input(getRestaurantTableByIdInput).query(async ({ ctx, input }) => {
    const row = await ctx.db
      .select()
      .from(restaurantTables)
      .where(and(eq(restaurantTables.id, input.id), eq(restaurantTables.tenantId, ctx.tenantId)))
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

  create: tableAdminProcedure.input(createRestaurantTableInput).mutation(async ({ ctx, input }) => {
    await ensureRestaurantSite(ctx.db, ctx.tenantId, input.siteId);

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
      await ctx.db.transaction(
        tx => {
          assertActiveTableCapacity(tx as unknown as typeof ctx.db, ctx.tenantId, input.siteId);
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
        },
        { behavior: 'immediate' }
      );
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

  update: tableAdminProcedure.input(updateRestaurantTableInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;
    const nowIso = new Date().toISOString();
    let nextRow: typeof restaurantTables.$inferSelect | undefined;
    let duplicateSiteId: string | undefined;
    let currentName: string | undefined;

    try {
      await ctx.db.transaction(
        tx => {
          const existing = tx
            .select()
            .from(restaurantTables)
            .where(and(eq(restaurantTables.id, id), eq(restaurantTables.tenantId, ctx.tenantId)))
            .get();
          if (!existing) {
            throwServerError({
              trpcCode: 'NOT_FOUND',
              errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
              message: `Restaurant table ${id} not found for this tenant`,
              details: { tenantId: ctx.tenantId, id },
            });
          }
          duplicateSiteId = existing.siteId;
          currentName = existing.name;
          if (!existing.isActive && updates.isActive === true) {
            assertActiveTableCapacity(
              tx as unknown as typeof ctx.db,
              ctx.tenantId,
              existing.siteId
            );
          }
          const openService = tx
            .select({
              id: restaurantServices.id,
              guestCount: restaurantServices.guestCount,
            })
            .from(restaurantServices)
            .where(
              and(
                eq(restaurantServices.tenantId, ctx.tenantId),
                eq(restaurantServices.tableId, id),
                eq(restaurantServices.status, 'open')
              )
            )
            .get();
          const openDraft = tx
            .select({ id: sales.id })
            .from(sales)
            .where(
              and(
                eq(sales.tenantId, ctx.tenantId),
                eq(sales.tableId, id),
                eq(sales.status, 'draft')
              )
            )
            .get();
          if ((openService || openDraft) && updates.isActive === false) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'RESTAURANT_TABLE_HAS_OPEN_SERVICE',
              message: 'Settle or cancel every open check or draft before deactivating this table',
            });
          }
          if (
            openService?.guestCount != null &&
            updates.seatCount != null &&
            updates.seatCount < openService.guestCount
          ) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'RESTAURANT_SERVICE_CAPACITY_EXCEEDED',
              message: 'Table capacity cannot be lower than its current party size',
              details: {
                guestCount: openService.guestCount,
                seatCount: updates.seatCount,
              },
            });
          }

          nextRow = {
            ...existing,
            ...(updates.name !== undefined ? { name: updates.name } : {}),
            ...(updates.seatCount !== undefined ? { seatCount: updates.seatCount } : {}),
            ...(updates.area !== undefined ? { area: updates.area } : {}),
            ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
            ...(updates.isActive !== undefined ? { isActive: updates.isActive } : {}),
            updatedAt: nowIso,
          };
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
            .where(and(eq(restaurantTables.id, id), eq(restaurantTables.tenantId, ctx.tenantId)))
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
        },
        { behavior: 'immediate' }
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        const duplicateName = updates.name ?? currentName;
        if (!duplicateName || !duplicateSiteId) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_TABLE_NAME_DUPLICATE',
            message: 'An active restaurant table with this name already exists for the site',
          });
        }
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_TABLE_NAME_DUPLICATE',
          message: `A restaurant table named '${duplicateName}' already exists for this site`,
          details: { siteId: duplicateSiteId, name: duplicateName },
        });
      }
      throw err;
    }

    if (!nextRow) {
      throw new Error('Restaurant table update committed without a result row');
    }
    return nextRow;
  }),

  archive: tableAdminProcedure
    .input(archiveRestaurantTableInput)
    .mutation(async ({ ctx, input }) => {
      const nowIso = new Date().toISOString();
      let archivedRow: typeof restaurantTables.$inferSelect | undefined;
      await ctx.db.transaction(
        tx => {
          const existing = tx
            .select()
            .from(restaurantTables)
            .where(
              and(eq(restaurantTables.id, input.id), eq(restaurantTables.tenantId, ctx.tenantId))
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

          const openService = tx
            .select({ id: restaurantServices.id })
            .from(restaurantServices)
            .where(
              and(
                eq(restaurantServices.tenantId, ctx.tenantId),
                eq(restaurantServices.tableId, input.id),
                eq(restaurantServices.status, 'open')
              )
            )
            .get();
          const openDraft = tx
            .select({ id: sales.id })
            .from(sales)
            .where(
              and(
                eq(sales.tenantId, ctx.tenantId),
                eq(sales.tableId, input.id),
                eq(sales.status, 'draft')
              )
            )
            .get();
          if (openService || openDraft) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'RESTAURANT_TABLE_HAS_OPEN_SERVICE',
              message: 'Settle or cancel every open check or draft before archiving this table',
            });
          }
          // Keep both the activity guard and this idempotency read inside the
          // immediate writer transaction. Historical versions allowed a table
          // to be archived while a draft remained attached, so an already
          // inactive row is only safely idempotent when no live work exists.
          if (existing.isActive === false) {
            archivedRow = existing;
            return;
          }
          const nextRow = { ...existing, isActive: false, updatedAt: nowIso };
          const result = tx
            .update(restaurantTables)
            .set({ isActive: false, updatedAt: nowIso })
            .where(
              and(
                eq(restaurantTables.id, input.id),
                eq(restaurantTables.tenantId, ctx.tenantId),
                eq(restaurantTables.isActive, true)
              )
            )
            .run() as { changes?: number };
          if ((result.changes ?? 0) !== 1) {
            throw new Error('Restaurant table archive lost its immediate transaction ownership');
          }
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
          archivedRow = nextRow;
        },
        { behavior: 'immediate' }
      );
      if (!archivedRow) {
        throw new Error('Restaurant table archive committed without a result row');
      }
      return archivedRow;
    }),
});

export type RestaurantTablesRouter = typeof restaurantTablesRouter;
