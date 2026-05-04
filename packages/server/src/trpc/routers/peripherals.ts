/**
 * ENG-060 — Peripherals tRPC router.
 *
 * Admin-only CRUD over `site_peripherals`, with a `test` action that
 * stamps `last_tested_at` + `last_test_result` based on the adapter's
 * `testPrint` / `testKick` / `testScan` / `testCharge` outcome.
 *
 * Tenant scoping: every procedure validates `siteId` via
 * `ensureSiteBelongsToTenant`, and every WHERE includes
 * `eq(sitePeripherals.tenantId, ctx.tenantId)`. Cross-tenant tests
 * cover the gate.
 *
 * @module trpc/routers/peripherals
 */

import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { sitePeripherals, sites, type PeripheralKind } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  instantiateAdapter,
  validatePeripheralConfig,
} from '../../services/peripherals/index.js';
import type {
  CashDrawerAdapter,
  PaymentTerminalAdapter,
  ReceiptPrinterAdapter,
  BarcodeScannerAdapter,
  TestResult,
} from '../../services/peripherals/index.js';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import {
  listPeripheralsInput,
  registerPeripheralInput,
  removePeripheralInput,
  setPeripheralActiveInput,
  testPeripheralInput,
  updatePeripheralInput,
} from '../schemas/peripherals.js';

async function ensureSiteBelongsToTenant(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string
) {
  const site = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
    .get();
  if (!site) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Site not found' });
  }
}

async function loadPeripheralOrThrow(
  db: DatabaseInstance,
  tenantId: string,
  id: string
) {
  const row = await db
    .select()
    .from(sitePeripherals)
    .where(
      and(eq(sitePeripherals.id, id), eq(sitePeripherals.tenantId, tenantId))
    )
    .get();
  if (!row) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'PERIPHERAL_NOT_FOUND',
      message: 'Peripheral not found',
    });
  }
  return row!;
}

async function runAdapterTest(adapter: ReturnType<typeof instantiateAdapter>): Promise<TestResult> {
  if (!adapter) {
    return {
      status: 'failed',
      message: 'Driver not implemented for this kind yet.',
      details: { code: 'PERIPHERAL_DRIVER_NOT_IMPLEMENTED' },
    };
  }
  switch (adapter.kind) {
    case 'printer':
      return (adapter as ReceiptPrinterAdapter).testPrint();
    case 'cash_drawer':
      return (adapter as CashDrawerAdapter).testKick();
    case 'scanner':
      return (adapter as BarcodeScannerAdapter).testScan();
    case 'payment_terminal':
      return (adapter as PaymentTerminalAdapter).testCharge();
    default:
      return { status: 'failed', message: 'Unknown adapter kind' };
  }
}

export const peripheralsRouter = router({
  /**
   * List every peripheral configured for the given site (active and
   * inactive both surface — the admin UI groups by kind and dims
   * inactive rows). Tenant-scoped.
   */
  list: adminProcedure
    .input(listPeripheralsInput)
    .query(async ({ ctx, input }) => {
      await ensureSiteBelongsToTenant(ctx.db, ctx.tenantId, input.siteId);
      return ctx.db
        .select()
        .from(sitePeripherals)
        .where(
          and(
            eq(sitePeripherals.tenantId, ctx.tenantId),
            eq(sitePeripherals.siteId, input.siteId)
          )
        )
        .orderBy(asc(sitePeripherals.kind), asc(sitePeripherals.createdAt))
        .all();
    }),

  register: adminProcedure
    .input(registerPeripheralInput)
    .mutation(async ({ ctx, input }) => {
      await ensureSiteBelongsToTenant(ctx.db, ctx.tenantId, input.siteId);
      const validation = validatePeripheralConfig({
        kind: input.kind,
        driver: input.driver,
        config: input.config,
      });
      if (!validation.ok) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: validation.code,
          message: validation.message,
        });
      }
      const id = nanoid();
      const now = new Date().toISOString();
      try {
        await ctx.db.insert(sitePeripherals).values({
          id,
          tenantId: ctx.tenantId,
          siteId: input.siteId,
          kind: input.kind,
          driver: input.driver,
          config: input.config,
          displayName: input.displayName ?? null,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err) {
        // Partial unique idx_site_peripherals_active_per_kind — surface
        // a translatable error code instead of a raw SqliteError.
        if (
          err instanceof Error &&
          /UNIQUE constraint failed.*site_peripherals/.test(err.message)
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'PERIPHERAL_ACTIVE_DUPLICATE',
            message:
              'Another active peripheral of this kind already exists for the site. Toggle it off before swapping drivers.',
          });
        }
        throw err;
      }
      return loadPeripheralOrThrow(ctx.db, ctx.tenantId, id);
    }),

  update: adminProcedure
    .input(updatePeripheralInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await loadPeripheralOrThrow(ctx.db, ctx.tenantId, input.id);
      const driver = input.driver ?? existing.driver;
      const config = input.config ?? existing.config;
      const validation = validatePeripheralConfig({
        kind: existing.kind as PeripheralKind,
        driver,
        config: config as Record<string, unknown>,
      });
      if (!validation.ok) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: validation.code,
          message: validation.message,
        });
      }
      const now = new Date().toISOString();
      await ctx.db
        .update(sitePeripherals)
        .set({
          driver,
          config: config as Record<string, unknown>,
          displayName:
            input.displayName === undefined ? existing.displayName : input.displayName,
          updatedAt: now,
        })
        .where(
          and(
            eq(sitePeripherals.id, input.id),
            eq(sitePeripherals.tenantId, ctx.tenantId)
          )
        );
      return loadPeripheralOrThrow(ctx.db, ctx.tenantId, input.id);
    }),

  setActive: adminProcedure
    .input(setPeripheralActiveInput)
    .mutation(async ({ ctx, input }) => {
      await loadPeripheralOrThrow(ctx.db, ctx.tenantId, input.id);
      const now = new Date().toISOString();
      try {
        await ctx.db
          .update(sitePeripherals)
          .set({ isActive: input.isActive, updatedAt: now })
          .where(
            and(
              eq(sitePeripherals.id, input.id),
              eq(sitePeripherals.tenantId, ctx.tenantId)
            )
          );
      } catch (err) {
        if (
          err instanceof Error &&
          /UNIQUE constraint failed.*site_peripherals/.test(err.message)
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'PERIPHERAL_ACTIVE_DUPLICATE',
            message:
              'Cannot activate this peripheral — another row of the same kind is already active for this site.',
          });
        }
        throw err;
      }
      return loadPeripheralOrThrow(ctx.db, ctx.tenantId, input.id);
    }),

  test: adminProcedure
    .input(testPeripheralInput)
    .mutation(async ({ ctx, input }) => {
      const row = await loadPeripheralOrThrow(ctx.db, ctx.tenantId, input.id);
      const adapter = instantiateAdapter(row);
      const result = await runAdapterTest(adapter);
      const now = new Date().toISOString();
      await ctx.db
        .update(sitePeripherals)
        .set({
          lastTestedAt: now,
          lastTestResult: result.status === 'ok' ? 'ok' : 'failed',
          lastTestDetails: (result.details ?? null) as Record<string, unknown> | null,
          updatedAt: now,
        })
        .where(
          and(
            eq(sitePeripherals.id, input.id),
            eq(sitePeripherals.tenantId, ctx.tenantId)
          )
        );
      return {
        ...result,
        peripheral: await loadPeripheralOrThrow(ctx.db, ctx.tenantId, input.id),
      };
    }),

  remove: adminProcedure
    .input(removePeripheralInput)
    .mutation(async ({ ctx, input }) => {
      await loadPeripheralOrThrow(ctx.db, ctx.tenantId, input.id);
      await ctx.db
        .delete(sitePeripherals)
        .where(
          and(
            eq(sitePeripherals.id, input.id),
            eq(sitePeripherals.tenantId, ctx.tenantId)
          )
        );
      return { ok: true as const };
    }),
});

export type PeripheralsRouter = typeof peripheralsRouter;
