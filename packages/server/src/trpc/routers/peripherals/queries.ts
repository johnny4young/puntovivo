/**
 * Peripherals router — read procedures ( split).
 *
 * list / activeForSite / peekHardwareOutbox +
 * buildReceiptBytes.  promotes buildDrawerKickBytes to an audited
 * critical mutation because returning the pulse authorizes physical I/O.
 *
 * @module trpc/routers/peripherals/queries
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { hardwareOutbox, sitePeripherals, tenants } from '../../../db/schema.js';
import {
  ESCPOS_BYTES,
  buildEscPosBytes,
  type EscPosCharset,
  type ReceiptDocument,
} from '../../../services/peripherals/escpos/byte-builder.js';
import { buildSaleReceiptDocument } from '../../../services/peripherals/index.js';
import { escposReceiptPrinterConfigSchema } from '../../../services/peripherals/drivers/escpos-receipt-printer.js';
import { escposCashDrawerConfigSchema } from '../../../services/peripherals/drivers/escpos-cash-drawer.js';
import { getSaleRecord } from '../../../application/sales/sale-read.js';
import { managerOrAdminProcedure } from '../../middleware/roles.js';
import { criticalCommandCashierManagerOrAdminProcedure } from '../../middleware/criticalCommand.js';
import { asCriticalCommandContext } from '../../middleware/commandEnvelope.js';
import {
  claimCashDrawerApproval,
  recordCashDrawerDispatch,
  releaseCashDrawerApproval,
} from '../../../application/peripherals/cashDrawerApproval.js';
import { ensureTenantSite } from '../../middleware/tenantSite.js';
import { tenantProcedure } from '../../middleware/tenant.js';
import {
  activeForSiteInput,
  buildDrawerKickBytesInput,
  buildReceiptBytesInput,
  listPeripheralsInput,
  peekHardwareOutboxInput,
  renderReceiptHtmlInput,
} from '../../schemas/peripherals.js';
import {
  renderSaleReceiptTemplate,
  resolveSaleReceiptTemplateContext,
} from '../../../services/receipt-renderer/index.js';
import { toSaleReceiptFiscalDocuments } from './helpers.js';

export const peripheralsQueryProcedures = {
  /**
   * List every peripheral configured for the given site (active and
   * inactive both surface — the admin UI groups by kind and dims
   * inactive rows). Tenant-scoped.
   */
  list: managerOrAdminProcedure.input(listPeripheralsInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return ctx.db
      .select()
      .from(sitePeripherals)
      .where(
        and(eq(sitePeripherals.tenantId, ctx.tenantId), eq(sitePeripherals.siteId, input.siteId))
      )
      .orderBy(asc(sitePeripherals.kind), asc(sitePeripherals.createdAt))
      .all();
  }),

  /**
   * sales-role read of the active peripherals for a site.
   *
   * The SalesPage uses this to load the active scanner's timing
   * config (`useBarcodeWedgeListener`);  will let cashiers
   * read printer config the same way. Returns a minimal projection
   * (kind + driver + config) so we never expose admin-only fields
   * like `lastTestDetails` or `displayName` to non-admin roles.
   * `peripherals.list` (admin) stays the full-row read for the
   * admin UI.
   */
  activeForSite: tenantProcedure.input(activeForSiteInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
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
   * Read-only HTML representation used by browser/Electron system printing.
   * Returns `legacy-fallback` only for tenants that genuinely have no active
   * sale/fiscal template, preserving upgrade compatibility without bypassing a
   * configured template.
   */
  renderReceiptHtml: tenantProcedure.input(renderReceiptHtmlInput).query(async ({ ctx, input }) => {
    const sale = await getSaleRecord(ctx.db, ctx.tenantId, input.saleId);
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    const templateContext = await resolveSaleReceiptTemplateContext({
      db: ctx.db,
      tenantId: ctx.tenantId,
      fallbackSiteId: input.siteId,
      sale,
    });
    if (!templateContext) {
      return {
        status: 'legacy-fallback' as const,
        html: null,
        templateId: null,
        templateKind: null,
      };
    }
    const rendered = renderSaleReceiptTemplate(templateContext);
    return {
      status: 'ready' as const,
      html: rendered.html,
      templateId: templateContext.template.id,
      templateKind: templateContext.template.kind,
    };
  }),

  /**
   * read-only "give me the bytes" for the hub_client
   * local hardware bridge.
   *
   * Resolves the same active declarative template used by `printReceipt`,
   * renders it against the configured printer width and codepage, and returns
   * the bytes plus transport hint so Electron main can dispatch through its
   * locally attached printer. Tenants without an active template retain the
   * legacy `ReceiptDocument` path.
   *
   * Per ADR-0008 rule 6 the procedure NEVER writes operational
   * tables: no `hardware_outbox` enqueue, no `adapter.print()`
   * call. The dispatcher on the terminal is the side effect; the
   * server only provides bytes.
   *
   * Tenant-scoped via `getSaleRecord(tenantId, saleId)` plus
   * `ensureTenantSite`. Same role gate as `printReceipt`
   * (`tenantProcedure` — cashier+).
   */
  buildReceiptBytes: tenantProcedure.input(buildReceiptBytesInput).query(async ({ ctx, input }) => {
    // Cross-tenant guard. Throws SALE_NOT_FOUND for foreign ids.
    const sale = await getSaleRecord(ctx.db, ctx.tenantId, input.saleId);
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);

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

    // No active escpos peripheral → renderer falls back to the
    // legacy HTML print path. Return an empty payload that the
    // bridge consumer can interpret as `system-fallback`.
    if (!printerRow || printerRow.driver !== 'escpos') {
      return {
        status: 'system-fallback' as const,
        bytes: [] as number[],
        paperWidth: null,
        characterSet: null,
        transportHint: null,
      };
    }

    const parsed = escposReceiptPrinterConfigSchema.safeParse(printerRow.config);
    if (!parsed.success) {
      return {
        status: 'system-fallback' as const,
        bytes: [] as number[],
        paperWidth: null,
        characterSet: null,
        transportHint: null,
      };
    }

    const config = parsed.data;
    const templateContext = await resolveSaleReceiptTemplateContext({
      db: ctx.db,
      tenantId: ctx.tenantId,
      fallbackSiteId: input.siteId,
      sale,
    });
    let bytes: Uint8Array;
    if (templateContext) {
      bytes = renderSaleReceiptTemplate(templateContext, {
        paperWidth: config.paperWidth,
        characterSet: config.characterSet,
        kickDrawer: config.kickDrawerAfterReceipt,
      }).escpos;
    } else {
      // Upgrade fallback: tenants without a configured declarative template
      // retain the same printable ESC/POS receipt they had before this path
      // started consuming templates.
      const tenantRow = await ctx.db
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .get();
      const baseDocument = buildSaleReceiptDocument(
        {
          header: { tenantName: tenantRow?.name ?? sale.tenantId },
          saleNumber: sale.saleNumber,
          customerName: sale.customerNameSnapshot ?? sale.customerName ?? undefined,
          items: sale.items.map(item => ({
            name:
              item.productNameSnapshot ??
              item.productName ??
              item.productSkuSnapshot ??
              item.productSku ??
              '—',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
          })),
          subtotal: sale.subtotal,
          taxAmount: sale.taxAmount,
          total: sale.total,
          totalLabel: 'TOTAL',
          fiscalDocuments: toSaleReceiptFiscalDocuments(sale.fiscalDocuments),
          formatCurrency: value => value.toFixed(2),
        },
        { kickDrawer: false }
      );
      const document: ReceiptDocument = {
        ...baseDocument,
        kickDrawer: config.kickDrawerAfterReceipt,
      };
      bytes = buildEscPosBytes(document, {
        paperWidth: config.paperWidth,
        characterSet: config.characterSet as EscPosCharset,
      });
    }

    return {
      status: 'ready' as const,
      bytes: Array.from(bytes),
      paperWidth: config.paperWidth,
      characterSet: config.characterSet,
      transportHint: {
        channel: config.channel,
        host: config.host ?? null,
        port: config.port ?? null,
        vendorId: config.vendorId ?? null,
        productId: config.productId ?? null,
        devicePath: config.devicePath ?? null,
        timeoutMs: config.timeoutMs ?? null,
      },
    };
  }),

  /**
   * /  — audited drawer-kick bytes for the hub_client
   * local hardware bridge. Same shape contract as
   * `buildReceiptBytes`: returns `ESCPOS_BYTES.DRAWER_KICK` plus
   * the transport hint of the active escpos cash_drawer
   * peripheral. The role/grant gate mirrors `kickCashDrawer`.
   */
  buildDrawerKickBytes: criticalCommandCashierManagerOrAdminProcedure
    .input(buildDrawerKickBytesInput)
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

      if (!drawerRow || drawerRow.driver !== 'escpos') {
        return {
          status: 'no-drawer-registered' as const,
          bytes: [] as number[],
          transportHint: null,
        };
      }

      const parsed = escposCashDrawerConfigSchema.safeParse(drawerRow.config);
      if (!parsed.success) {
        return {
          status: 'no-drawer-registered' as const,
          bytes: [] as number[],
          transportHint: null,
        };
      }

      const config = parsed.data;
      const criticalCtx = asCriticalCommandContext(ctx);
      const approvalContext = {
        db: criticalCtx.db,
        tenantId: criticalCtx.tenantId,
        siteId: input.siteId,
        user: { id: criticalCtx.user.id, role: criticalCtx.user.role },
        envelope: criticalCtx.envelope,
        deviceId: criticalCtx.deviceId,
        log: criticalCtx.req?.server?.log,
      };
      const approvalClaim = claimCashDrawerApproval(approvalContext, input.approvalRequestId);
      try {
        await recordCashDrawerDispatch(approvalContext, {
          claim: approvalClaim,
          peripheralId: drawerRow.id,
          dispatchMode: 'hub_client',
        });
      } catch (error) {
        releaseCashDrawerApproval(approvalContext, approvalClaim);
        throw error;
      }
      return {
        status: 'ready' as const,
        bytes: Array.from(ESCPOS_BYTES.DRAWER_KICK),
        transportHint: {
          channel: config.channel,
          host: config.host ?? null,
          port: config.port ?? null,
          vendorId: config.vendorId ?? null,
          productId: config.productId ?? null,
          devicePath: config.devicePath ?? null,
          timeoutMs: config.timeoutMs ?? null,
        },
      };
    }),

  /**
   * operator-visible peek into the hardware outbox tail.
   * Stub for 's Operations Center; returns a minimal
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
};
