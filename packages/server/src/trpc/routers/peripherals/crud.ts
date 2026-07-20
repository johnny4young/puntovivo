/**
 * Peripherals router — admin CRUD procedures ( split).
 *
 * register / update / setActive / test / remove for `site_peripherals`.
 *
 * @module trpc/routers/peripherals/crud
 */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { sitePeripherals, type PeripheralKind } from '../../../db/schema.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import {
  instantiateAdapter,
  validatePeripheralConfig,
} from '../../../services/peripherals/index.js';
import { adminProcedure } from '../../middleware/roles.js';
import { ensureTenantSite } from '../../middleware/tenantSite.js';
import {
  registerPeripheralInput,
  removePeripheralInput,
  setPeripheralActiveInput,
  testPeripheralInput,
  updatePeripheralInput,
} from '../../schemas/peripherals.js';
import { loadPeripheralOrThrow, runAdapterTest } from './helpers.js';

export const peripheralsCrudProcedures = {
  register: adminProcedure.input(registerPeripheralInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
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
      if (err instanceof Error && /UNIQUE constraint failed.*site_peripherals/.test(err.message)) {
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

  update: adminProcedure.input(updatePeripheralInput).mutation(async ({ ctx, input }) => {
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
        displayName: input.displayName === undefined ? existing.displayName : input.displayName,
        updatedAt: now,
      })
      .where(and(eq(sitePeripherals.id, input.id), eq(sitePeripherals.tenantId, ctx.tenantId)));
    return loadPeripheralOrThrow(ctx.db, ctx.tenantId, input.id);
  }),

  setActive: adminProcedure.input(setPeripheralActiveInput).mutation(async ({ ctx, input }) => {
    await loadPeripheralOrThrow(ctx.db, ctx.tenantId, input.id);
    const now = new Date().toISOString();
    try {
      await ctx.db
        .update(sitePeripherals)
        .set({ isActive: input.isActive, updatedAt: now })
        .where(and(eq(sitePeripherals.id, input.id), eq(sitePeripherals.tenantId, ctx.tenantId)));
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed.*site_peripherals/.test(err.message)) {
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

  test: adminProcedure.input(testPeripheralInput).mutation(async ({ ctx, input }) => {
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
      .where(and(eq(sitePeripherals.id, input.id), eq(sitePeripherals.tenantId, ctx.tenantId)));
    return {
      ...result,
      peripheral: await loadPeripheralOrThrow(ctx.db, ctx.tenantId, input.id),
    };
  }),

  remove: adminProcedure.input(removePeripheralInput).mutation(async ({ ctx, input }) => {
    await loadPeripheralOrThrow(ctx.db, ctx.tenantId, input.id);
    await ctx.db
      .delete(sitePeripherals)
      .where(and(eq(sitePeripherals.id, input.id), eq(sitePeripherals.tenantId, ctx.tenantId)));
    return { ok: true as const };
  }),
};
