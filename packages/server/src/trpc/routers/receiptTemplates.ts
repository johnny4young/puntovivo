/**
 * Receipt Templates tRPC Router (Iter 2 — declarative editor + pure renderer).
 *
 * Procedures (all admin-only — receipt templates are tenant-wide
 * configuration that affects every printed sale, so cashiers must not
 * edit them):
 *  - `receiptTemplates.list`           — list templates, optionally filtered by kind
 *  - `receiptTemplates.getById`        — single template detail
 *  - `receiptTemplates.create`         — insert a template
 *  - `receiptTemplates.update`         — update name / layout / active flag
 *  - `receiptTemplates.delete`         — delete (with last-template-for-kind guard)
 *  - `receiptTemplates.setDefault`     — promote to default for its kind atomically
 *  - `receiptTemplates.duplicate`      — copy with " (copy)" name suffix
 *  - `receiptTemplates.renderPreview`  — render mock data through a saved or inline layout
 *
 * The `renderPreview` procedure exists so the live editor can produce
 * an HTML preview without a save round-trip; it accepts an inline
 * `layout` payload that has already been validated by the same Zod
 * schema as `create` / `update`.
 *
 * @module trpc/routers/receiptTemplates
 */

import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { ServerErrorWithCode } from '../../lib/errorCodes.js';
import { companies, tenants } from '../../db/schema.js';
import {
  createReceiptTemplate,
  deleteReceiptTemplate,
  duplicateReceiptTemplate,
  getReceiptTemplateById,
  listReceiptTemplates,
  setDefaultReceiptTemplate,
  updateReceiptTemplate,
} from '../../services/receipt-templates.js';
import {
  buildPreviewData,
  renderReceipt,
} from '../../services/receipt-renderer.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';
import {
  createReceiptTemplateInput,
  deleteReceiptTemplateInput,
  duplicateReceiptTemplateInput,
  getReceiptTemplateInput,
  listReceiptTemplatesInput,
  renderPreviewReceiptTemplateInput,
  setDefaultReceiptTemplateInput,
  updateReceiptTemplateInput,
} from '../schemas/receiptTemplates.js';

function isFiscalDianEnabled(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') {
    return false;
  }
  const record = settings as Record<string, unknown>;
  const flag = record.fiscal_dian_enabled ?? record.fiscalDianEnabled;
  return flag === true || flag === 'true' || flag === 1;
}

export const receiptTemplatesRouter = router({
  list: adminProcedure
    .input(listReceiptTemplatesInput)
    .query(({ ctx, input }) => {
      const items = listReceiptTemplates(ctx.db, ctx.tenantId, {
        kind: input?.kind,
        includeInactive: input?.includeInactive,
        limit: input?.limit,
      });
      return { items };
    }),

  getById: adminProcedure
    .input(getReceiptTemplateInput)
    .query(({ ctx, input }) => {
      const detail = getReceiptTemplateById(ctx.db, ctx.tenantId, input.id);
      if (!detail) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Receipt template not found',
          cause: new ServerErrorWithCode(
            'RECEIPT_TEMPLATE_NOT_FOUND',
            'Receipt template not found',
            { templateId: input.id }
          ),
        });
      }
      return detail;
    }),

  create: adminProcedure
    .input(createReceiptTemplateInput)
    .mutation(async ({ ctx, input }) => {
      return createReceiptTemplate(ctx.db, {
        tenantId: ctx.tenantId,
        kind: input.kind,
        name: input.name,
        layout: input.layout,
        isDefault: input.isDefault,
        isActive: input.isActive,
        createdBy: ctx.user!.id,
      });
    }),

  update: adminProcedure
    .input(updateReceiptTemplateInput)
    .mutation(async ({ ctx, input }) => {
      return updateReceiptTemplate(ctx.db, {
        tenantId: ctx.tenantId,
        templateId: input.id,
        name: input.name,
        layout: input.layout,
        isActive: input.isActive,
        actorId: ctx.user!.id,
      });
    }),

  delete: adminProcedure
    .input(deleteReceiptTemplateInput)
    .mutation(async ({ ctx, input }) => {
      return deleteReceiptTemplate(ctx.db, {
        tenantId: ctx.tenantId,
        templateId: input.id,
      });
    }),

  setDefault: adminProcedure
    .input(setDefaultReceiptTemplateInput)
    .mutation(async ({ ctx, input }) => {
      return setDefaultReceiptTemplate(ctx.db, {
        tenantId: ctx.tenantId,
        templateId: input.id,
      });
    }),

  duplicate: adminProcedure
    .input(duplicateReceiptTemplateInput)
    .mutation(async ({ ctx, input }) => {
      return duplicateReceiptTemplate(ctx.db, {
        tenantId: ctx.tenantId,
        templateId: input.id,
        name: input.name,
        actorId: ctx.user!.id,
      });
    }),

  renderPreview: adminProcedure
    .input(renderPreviewReceiptTemplateInput)
    .query(async ({ ctx, input }) => {
      // Resolve the layout: either the inline draft from the editor or
      // the persisted layout of an existing template (for the read-only
      // preview shown in the list page).
      let kind = input.kind;
      let layout = input.layout;

      if (!layout) {
        if (!input.id) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'renderPreview requires either an inline layout or a template id',
          });
        }
        const persisted = getReceiptTemplateById(ctx.db, ctx.tenantId, input.id);
        if (!persisted) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Receipt template not found',
            cause: new ServerErrorWithCode(
              'RECEIPT_TEMPLATE_NOT_FOUND',
              'Receipt template not found',
              { templateId: input.id }
            ),
          });
        }
        layout = persisted.layout;
        kind = kind ?? persisted.kind;
      }

      // ENG-017 — resolve the tenant's locale once so the preview
      // renders currency amounts in the operator's country format
      // (COP 0 decimals, USD 2 decimals, CLP 0/0, etc.). Fallback
      // inside `resolveTenantLocale` keeps the preview rendering when
      // the tenant has not yet configured locale settings.
      const resolvedLocale = await resolveTenantLocale(
        ctx.db,
        ctx.tenantId
      );
      const data = {
        ...buildPreviewData(kind ?? 'sale'),
        locale: {
          locale: resolvedLocale.locale,
          currency: resolvedLocale.currency,
          legalDecimals: resolvedLocale.legalDecimals,
          displayDecimals: resolvedLocale.displayDecimals,
          dateFormat: resolvedLocale.dateFormatShort,
        },
      };
      const rendered = renderReceipt(layout, data, input.labels);
      return {
        kind: kind ?? 'sale',
        html: rendered.html,
        // The editor preview only needs the HTML — ESC/POS bytes come
        // back as length so the UI can show "≈N bytes". The actual byte
        // stream is only useful at print time.
        escposByteLength: rendered.escpos.length,
      };
    }),

  /**
   * ENG-016 pass 5 — Per-tenant variable availability map.
   *
   * Reports whether each documented `namespace.field` will resolve to
   * a non-empty value at render time on the active tenant. The editor
   * uses this map to dim tokens that the operator typed but that the
   * tenant has not configured (e.g. `{{ fiscal.cufe }}` on a tenant
   * with `fiscal_dian_enabled` off, or `{{ company.email }}` when the
   * companies row never set the optional email column).
   *
   * Contract:
   *  - `company.*` reflects the actual `companies` row's columns.
   *    `name` is `notNull` in the schema so always `true`. The other
   *    fields (`taxId`, `address`, `phone`, `email`) are nullable, so
   *    return whether the column carries a non-empty value. `city`
   *    has no schema column today and pins to `false` until that gap
   *    is closed in a separate ticket.
   *  - `sale.*`, `item.*`, `tender.*` always come back `true`. These
   *    fields exist on every sale / line / payment row at render time
   *    (some are nullable per-row, but the editor cannot reason about
   *    per-sale data — only per-tenant). The keys are still returned
   *    so the consumer can do `availability.sale[prop]` without a
   *    fallback ternary.
   *  - `fiscal.*` returns the value of `tenants.settings.fiscal_dian_enabled`.
   *    When off, the renderer never populates these fields and the
   *    editor dims them at edit time as a hint.
   */
  variableAvailability: adminProcedure.query(async ({ ctx }) => {
    const company = await ctx.db
      .select({
        taxId: companies.taxId,
        address: companies.address,
        phone: companies.phone,
        email: companies.email,
      })
      .from(companies)
      .where(eq(companies.tenantId, ctx.tenantId))
      .get();

    const tenant = await ctx.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .get();

    const fiscalEnabled = isFiscalDianEnabled(tenant?.settings);

    const isPopulated = (value: string | null | undefined) =>
      typeof value === 'string' && value.trim().length > 0;

    return {
      company: {
        name: true,
        taxId: isPopulated(company?.taxId),
        address: isPopulated(company?.address),
        phone: isPopulated(company?.phone),
        email: isPopulated(company?.email),
        // No schema column maps to `company.city` today. Pin to false
        // until that gap is closed in a separate ticket.
        city: false,
      },
      sale: {
        saleNumber: true,
        cashier: true,
        site: true,
        customer: true,
        customerTaxId: true,
        createdAt: true,
        subtotal: true,
        discount: true,
        taxTotal: true,
        tip: true,
        // ENG-039d3 — service charge surfaces alongside tip on every
        // sale render. The rate is per-sale (frozen at finalize time)
        // so editors can bind `{{ sale.serviceChargeRate }}` for the
        // "Servicio (10%)" label.
        serviceCharge: true,
        serviceChargeRate: true,
        grandTotal: true,
        changeDue: true,
        notes: true,
      },
      item: {
        name: true,
        sku: true,
        qty: true,
        unitPrice: true,
        taxPercent: true,
        discount: true,
        total: true,
      },
      fiscal: {
        cufe: fiscalEnabled,
        qrUrl: fiscalEnabled,
        resolution: fiscalEnabled,
        documentNumber: fiscalEnabled,
      },
      tender: {
        method: true,
        amount: true,
        reference: true,
      },
    };
  }),
});
