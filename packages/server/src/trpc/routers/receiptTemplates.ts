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
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { ServerErrorWithCode } from '../../lib/errorCodes.js';
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
    .query(({ ctx, input }) => {
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

      const data = buildPreviewData(kind ?? 'sale');
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
});
