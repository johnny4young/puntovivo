/**
 * Peripherals router — hardware-action procedures (ENG-178 split).
 *
 * ENG-062/065a — printReceipt / kickCashDrawer dispatch + retryHardwareOutbox.
 *
 * @module trpc/routers/peripherals/actions
 */
import { and, eq } from 'drizzle-orm';
import { hardwareOutbox, sitePeripherals, tenants } from '../../../db/schema.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { instantiateAdapter, tickDefaultHardwareWorker, buildSaleReceiptDocument } from '../../../services/peripherals/index.js';
import { enqueueHardware } from '../../../services/peripherals/enqueue-hardware.js';
import type { CashDrawerAdapter, ReceiptPrinterAdapter } from '../../../services/peripherals/index.js';
import { getSaleRecord } from '../../../application/sales/sale-read.js';
import { adminProcedure, managerOrAdminProcedure } from '../../middleware/roles.js';
import { ensureTenantSite } from '../../middleware/tenantSite.js';
import { tenantProcedure } from '../../middleware/tenant.js';
import { kickCashDrawerInput, printReceiptInput, retryHardwareOutboxInput } from '../../schemas/peripherals.js';

export const peripheralsActionProcedures = {

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
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);

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

      const tenantRow = await ctx.db
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .get();
      const document = buildSaleReceiptDocument(
        {
          header: { tenantName: tenantRow?.name ?? sale.tenantId },
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
      // ENG-067b — pipe the optional input.idempotencyKey through so
      // a tRPC retry of the same logical print attempt collapses to
      // one row instead of stacking duplicates. Helper handles the
      // partial-unique-idx UNIQUE conflict gracefully.
      try {
        await enqueueHardware(
          { db: ctx.db, tenantId: ctx.tenantId },
          {
            kind: 'print-receipt',
            peripheralId: printerRow.id,
            payload: {
              kind: 'print-receipt',
              document,
              saleId: sale.id,
              siteId: input.siteId,
            },
            status: 'retrying',
            attempts: 1,
            nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
            lastError: {
              errorCode: result.error?.kind ?? 'UNKNOWN',
              providerMessage: result.error?.message ?? 'unknown error',
              recoverable: true,
            },
            idempotencyKey: input.idempotencyKey ?? null,
          }
        );
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
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
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

      // Enqueue retry — drawer kicks are idempotent at the relay
      // level. ENG-067b also makes the enqueue itself idempotent
      // when the caller passes an idempotencyKey.
      try {
        await enqueueHardware(
          { db: ctx.db, tenantId: ctx.tenantId },
          {
            kind: 'kick-drawer',
            peripheralId: drawerRow.id,
            payload: { kind: 'kick-drawer', siteId: input.siteId },
            status: 'retrying',
            attempts: 1,
            nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
            lastError: {
              errorCode: result.error?.kind ?? 'UNKNOWN',
              providerMessage: result.error?.message ?? 'kick failed',
              recoverable: true,
            },
            idempotencyKey: input.idempotencyKey ?? null,
          }
        );
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
};
