/**
 * ENG-060 — Peripherals tRPC router.
 *
 * Admin-only writes over `site_peripherals`, with a `test` action that
 * stamps `last_tested_at` + `last_test_result` based on the adapter's
 * `testPrint` / `testKick` / `testScan` / `testCharge` outcome. Read
 * access is manager+ for the ENG-065a Operations Center.
 *
 * Tenant scoping: every procedure validates `siteId` via
 * `ensureSiteBelongsToTenant`, and every WHERE includes
 * `eq(sitePeripherals.tenantId, ctx.tenantId)`. Cross-tenant tests
 * cover the gate.
 *
 * @module trpc/routers/peripherals
 */

import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  hardwareOutbox,
  sitePeripherals,
  sites,
  type PeripheralKind,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  instantiateAdapter,
  validatePeripheralConfig,
  tickDefaultHardwareWorker,
} from '../../services/peripherals/index.js';
import type {
  CashDrawerAdapter,
  PaymentTerminalAdapter,
  ReceiptPrinterAdapter,
  BarcodeScannerAdapter,
  TestResult,
} from '../../services/peripherals/index.js';
import { buildSaleReceiptDocument } from '../../services/peripherals/index.js';
import { getSaleRecord } from '../../application/sales/sale-read.js';
import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { tenantProcedure } from '../middleware/tenant.js';
import {
  activeForSiteInput,
  kickCashDrawerInput,
  listPeripheralsInput,
  peekHardwareOutboxInput,
  printReceiptInput,
  registerPeripheralInput,
  removePeripheralInput,
  retryHardwareOutboxInput,
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
  list: managerOrAdminProcedure
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

  /**
   * ENG-061 — sales-role read of the active peripherals for a site.
   *
   * The SalesPage uses this to load the active scanner's timing
   * config (`useBarcodeWedgeListener`); ENG-062 will let cashiers
   * read printer config the same way. Returns a minimal projection
   * (kind + driver + config) so we never expose admin-only fields
   * like `lastTestDetails` or `displayName` to non-admin roles.
   * `peripherals.list` (admin) stays the full-row read for the
   * admin UI.
   */
  activeForSite: tenantProcedure
    .input(activeForSiteInput)
    .query(async ({ ctx, input }) => {
      await ensureSiteBelongsToTenant(ctx.db, ctx.tenantId, input.siteId);
      const rows = await ctx.db
        .select({
          kind: sitePeripherals.kind,
          driver: sitePeripherals.driver,
          config: sitePeripherals.config,
        })
        .from(sitePeripherals)
        .where(
          and(
            eq(sitePeripherals.tenantId, ctx.tenantId),
            eq(sitePeripherals.siteId, input.siteId),
            eq(sitePeripherals.isActive, true)
          )
        )
        .orderBy(asc(sitePeripherals.kind))
        .all();
      return rows;
    }),

  /**
   * ENG-062 — orchestrate the receipt print after a sale completes.
   *
   * Server flow:
   *   1. Resolve the sale (cross-tenant guard via getSaleRecord).
   *   2. Read the active printer peripheral; if none OR driver=system,
   *      return `{status:'system-fallback'}` so the renderer prints
   *      via the legacy `window.electron.printReceipt(html)` path.
   *   3. If driver=escpos, build the ReceiptDocument server-side and
   *      synchronously call `adapter.print(job)`. On success →
   *      `{status:'printed'}`. On error → enqueue a hardware_outbox
   *      row + return `{status:'fallback', error}` so the renderer
   *      falls back to the legacy HTML path AND surfaces a toast.
   *
   * `tenantProcedure` because cashiers print receipts. Cross-tenant
   * isolation comes from `getSaleRecord(tenantId, saleId)`.
   */
  printReceipt: tenantProcedure
    .input(printReceiptInput)
    .mutation(async ({ ctx, input }) => {
      // Cross-tenant guard. Throws SALE_NOT_FOUND for foreign ids.
      const sale = await getSaleRecord(ctx.db, ctx.tenantId, input.saleId);
      await ensureSiteBelongsToTenant(ctx.db, ctx.tenantId, input.siteId);

      // Find the active printer peripheral for the active site.
      const printerRow = await ctx.db
        .select()
        .from(sitePeripherals)
        .where(
          and(
            eq(sitePeripherals.tenantId, ctx.tenantId),
            eq(sitePeripherals.siteId, input.siteId),
            eq(sitePeripherals.kind, 'printer'),
            eq(sitePeripherals.isActive, true)
          )
        )
        .get();

      if (!printerRow || printerRow.driver === 'system') {
        return { status: 'system-fallback' as const };
      }

      // ESC/POS path: build the structured receipt document + dispatch.
      const adapter = instantiateAdapter(printerRow);
      if (!adapter || adapter.kind !== 'printer') {
        return {
          status: 'fallback' as const,
          error: 'DRIVER_NOT_IMPLEMENTED',
          errorMessage: 'Active printer driver is not registered',
        };
      }

      const document = buildSaleReceiptDocument(
        {
          header: { tenantName: sale.tenantId },
          saleNumber: sale.saleNumber,
          customerName: sale.customerName ?? undefined,
          items: sale.items.map(item => ({
            name: item.productName ?? item.productSku ?? '—',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
          })),
          subtotal: sale.subtotal,
          taxAmount: sale.taxAmount,
          total: sale.total,
          totalLabel: 'TOTAL',
          formatCurrency: v => v.toFixed(2),
        },
        { kickDrawer: false }
      );

      const result = await (adapter as ReceiptPrinterAdapter).print({
        kind: 'sale-receipt',
        metadata: { document, saleId: sale.id },
      });

      if (result.status === 'ok') {
        return { status: 'printed' as const };
      }

      // Enqueue a retry row so the worker drains it later.
      try {
        await ctx.db.insert(hardwareOutbox).values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          status: 'retrying',
          kind: 'print-receipt',
          peripheralId: printerRow.id,
          payload: {
            kind: 'print-receipt',
            document,
            saleId: sale.id,
            siteId: input.siteId,
          } as Record<string, unknown>,
          attempts: 1,
          nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
          lastError: {
            errorCode: result.error?.kind ?? 'UNKNOWN',
            providerMessage: result.error?.message ?? 'unknown error',
            recoverable: true,
          } as Record<string, unknown>,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        // Fire-and-forget tick so the next periodic interval isn't
        // the only retry chance.
        void tickDefaultHardwareWorker(ctx.tenantId);
      } catch (err) {
        // Enqueue failure does not change the user-visible outcome —
        // we already know the print failed and the renderer will
        // fall back. Just log.
        ctx.req.log.warn(
          { err, saleId: input.saleId },
          'hardware outbox enqueue failed; renderer fallback still fires'
        );
      }

      return {
        status: 'fallback' as const,
        error: result.error?.kind ?? 'UNKNOWN',
        errorMessage: result.error?.message ?? 'ESC/POS print failed',
      };
    }),

  /**
   * ENG-062 — manager-gated cash drawer kick. Idempotent: re-firing
   * the pulse just relays the drawer again, harmless on every model
   * we've tested. When no drawer is registered, we return a polite
   * `{status:'no-drawer-registered'}` instead of throwing — the UI
   * decides whether to surface a toast or hide the button.
   */
  kickCashDrawer: managerOrAdminProcedure
    .input(kickCashDrawerInput)
    .mutation(async ({ ctx, input }) => {
      await ensureSiteBelongsToTenant(ctx.db, ctx.tenantId, input.siteId);
      const drawerRow = await ctx.db
        .select()
        .from(sitePeripherals)
        .where(
          and(
            eq(sitePeripherals.tenantId, ctx.tenantId),
            eq(sitePeripherals.siteId, input.siteId),
            eq(sitePeripherals.kind, 'cash_drawer'),
            eq(sitePeripherals.isActive, true)
          )
        )
        .get();

      if (!drawerRow) {
        return { status: 'no-drawer-registered' as const };
      }

      const adapter = instantiateAdapter(drawerRow);
      if (!adapter || adapter.kind !== 'cash_drawer') {
        return {
          status: 'error' as const,
          error: 'DRIVER_NOT_IMPLEMENTED',
          errorMessage: 'Active drawer driver is not registered',
        };
      }
      const result = await (adapter as CashDrawerAdapter).kick();
      if (result.status === 'ok') {
        return { status: 'ok' as const };
      }

      // Enqueue retry — drawer kicks are idempotent.
      try {
        await ctx.db.insert(hardwareOutbox).values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          status: 'retrying',
          kind: 'kick-drawer',
          peripheralId: drawerRow.id,
          payload: { kind: 'kick-drawer', siteId: input.siteId } as Record<string, unknown>,
          attempts: 1,
          nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
          lastError: {
            errorCode: result.error?.kind ?? 'UNKNOWN',
            providerMessage: result.error?.message ?? 'kick failed',
            recoverable: true,
          } as Record<string, unknown>,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        void tickDefaultHardwareWorker(ctx.tenantId);
      } catch (err) {
        ctx.req.log.warn({ err, siteId: input.siteId }, 'drawer outbox enqueue failed');
      }

      return {
        status: 'error' as const,
        error: result.error?.kind ?? 'UNKNOWN',
        errorMessage: result.error?.message ?? 'Drawer kick failed',
      };
    }),

  /**
   * ENG-062 — operator-visible peek into the hardware outbox tail.
   * Stub for ENG-065's Operations Center; returns a minimal
   * projection so the UI doesn't load the full payload by default.
   * Tenant-scoped + manager-or-admin gated.
   */
  peekHardwareOutbox: managerOrAdminProcedure
    .input(peekHardwareOutboxInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: hardwareOutbox.id,
          kind: hardwareOutbox.kind,
          status: hardwareOutbox.status,
          attempts: hardwareOutbox.attempts,
          peripheralId: hardwareOutbox.peripheralId,
          lastError: hardwareOutbox.lastError,
          createdAt: hardwareOutbox.createdAt,
          updatedAt: hardwareOutbox.updatedAt,
        })
        .from(hardwareOutbox)
        .where(eq(hardwareOutbox.tenantId, ctx.tenantId))
        .orderBy(desc(hardwareOutbox.createdAt))
        .limit(input.limit)
        .all();
      return rows;
    }),

  /**
   * ENG-065a — Reset a `hardware_outbox` row so the worker picks it
   * up fresh. Operator path for "this row got stuck on a transient
   * driver error; force a retry now". Retryable rows
   * (`retrying` / `dead_letter` / `failed`) reset `attempts=0`,
   * clear `lastError`, move status back to `queued`, and clear
   * `nextRetryAt`/`claimToken`/`lockedAt`.
   * `queued` / `submitting` / `printed` are no-ops so a drained
   * row cannot be accidentally replayed. Admin-only — mirrors
   * `sync.retry` and `reports.fiscal.retryDocument`.
   */
  retryHardwareOutbox: adminProcedure
    .input(retryHardwareOutboxInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({ id: hardwareOutbox.id, status: hardwareOutbox.status })
        .from(hardwareOutbox)
        .where(
          and(
            eq(hardwareOutbox.id, input.id),
            eq(hardwareOutbox.tenantId, ctx.tenantId)
          )
        )
        .get();
      if (!existing) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'HARDWARE_OUTBOX_NOT_FOUND',
          message: 'hardware_outbox row not found',
        });
      }
      const RETRYABLE = ['retrying', 'dead_letter', 'failed'] as const;
      const isRetryable = (RETRYABLE as readonly string[]).includes(existing.status);
      if (!isRetryable) {
        return { ok: true as const, id: input.id };
      }
      const now = new Date().toISOString();
      await ctx.db
        .update(hardwareOutbox)
        .set({
          status: 'queued',
          attempts: 0,
          nextRetryAt: null,
          lastError: null,
          claimToken: null,
          lockedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(hardwareOutbox.id, input.id),
            eq(hardwareOutbox.tenantId, ctx.tenantId)
          )
        );
      // Mirror of `sync.retry` (ENG-064): no fire-and-forget tick —
      // the next periodic worker tick (30s default) drains the
      // requeued row. Avoids re-failing the row immediately when
      // the underlying transient error has not yet cleared.
      return { ok: true as const, id: input.id };
    }),
});

export type PeripheralsRouter = typeof peripheralsRouter;
