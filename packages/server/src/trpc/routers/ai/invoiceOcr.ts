/**
 * AI router — invoice OCR sub-router ( split).
 *
 * / AI Núcleo 2026-05-15 — `ai.invoiceOcr.{extract,confirm}`.
 *
 * Sits next to the legacy `ai.extractInvoiceLines` mutation (still
 * consumed by the deprecated `InvoiceOcrPreviewModal`). The new
 * surface returns a richer `PurchaseDraft` shape — supplier + NIT +
 * invoice number + per-line confidence + linesSum reconciliation —
 * and writes audit-log rows on every extract + confirm so the
 * AiConfigPage table can replay cost / latency / actor per request.
 *
 * @module trpc/routers/ai/invoiceOcr
 */

import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { router } from '../../init.js';
import { managerOrAdminProcedure } from '../../middleware/roles.js';
import { resolveAISettings } from '../../../services/ai/index.js';
import { matchInvoiceLinesToProducts } from '../../../services/ai/vision/index.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { normalizeColombianInvoice } from '../../../services/ai/invoice/normalize-co.js';
import { extractInvoiceWithAdmission } from '../../../services/ai/invoice/admission.js';
import { requireAiQuotaAvailable } from '../../../services/ai/quotas.js';
import { withClientAbortSignal } from '../../request-abort.js';
import { createOcrDraftPurchase } from '../../../application/purchases/index.js';
import { writeAuditLog } from '../../../services/audit-logs.js';
import { confirmInvoiceDraftInput, extractInvoiceOcrInput } from '../../schemas/ai-vision.js';
import { invoiceUploads } from '../../../db/schema.js';
import { findProviderIdForInvoice } from './helpers.js';

export const invoiceOcrRouter = router({
  extract: managerOrAdminProcedure
    .input(extractInvoiceOcrInput)
    .mutation(async ({ ctx, input }) => {
      const settings = await resolveAISettings(ctx.db, ctx.tenantId);
      if (!settings.enabled || settings.features?.invoiceOcr.enabled !== true) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'AI_DISABLED',
          message: 'Invoice OCR is disabled for this tenant',
        });
      }
      const siteId = ctx.siteId;
      if (!siteId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Select an active site before extracting an invoice',
        });
      }
      // Fast quota rejection; reserveAiBudget repeats it under BEGIN IMMEDIATE
      // so concurrent requests cannot both pass the last available slot.
      await requireAiQuotaAvailable({
        db: ctx.db,
        tenantId: ctx.tenantId,
        siteId,
        feature: 'invoiceOcr',
      });

      const upload = await ctx.db
        .select()
        .from(invoiceUploads)
        .where(
          and(
            eq(invoiceUploads.id, input.uploadId),
            eq(invoiceUploads.tenantId, ctx.tenantId),
            eq(invoiceUploads.siteId, siteId)
          )
        )
        .get();

      if (!upload) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invoice upload not found',
        });
      }

      const userId = ctx.user!.id;
      const ocrProvider = settings.features?.invoiceOcr.provider ?? 'textract';
      if (ocrProvider !== 'textract') {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'AI_PROVIDER_ERROR',
          message: `${ocrProvider} invoice OCR provider is not wired yet`,
        });
      }

      const { result: textractResult, auditLogId: aiAuditLogId } = await withClientAbortSignal(
        ctx.res,
        abortSignal =>
          extractInvoiceWithAdmission(
            { db: ctx.db, tenantId: ctx.tenantId, siteId, userId, abortSignal },
            {
              documentBase64: upload.payloadBase64,
              mimeType: upload.mimeType as Parameters<
                typeof extractInvoiceWithAdmission
              >[1]['mimeType'],
            }
          )
      );

      const normalized = normalizeColombianInvoice({
        supplierName: textractResult.invoice.supplierName,
        supplierTaxId: textractResult.invoice.supplierTaxId,
        invoiceNumber: textractResult.invoice.invoiceNumber,
        subtotal: textractResult.invoice.subtotal,
        taxAmount: textractResult.invoice.taxAmount,
        lines: textractResult.invoice.lines.map(l => ({ totalLine: l.totalLine })),
      });

      const lineMatches = textractResult.invoice.lines.length
        ? await matchInvoiceLinesToProducts(
            { db: ctx.db, tenantId: ctx.tenantId, siteId: ctx.siteId, userId },
            textractResult.invoice.lines.map(l => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              totalLine: l.totalLine,
            })),
            { bestEffortSkuFallback: true }
          ).catch(() => null)
        : null;

      const matchedLookup = new Map<
        number,
        {
          productId: string | null;
          productName: string | null;
          productSku: string | null;
          unitId: string | null;
          unitName: string | null;
          unitEquivalence: number | null;
          source: 'sku' | 'embedding' | null;
        }
      >();
      if (lineMatches && lineMatches.mode === 'matched') {
        lineMatches.matches.forEach((match, idx) => {
          matchedLookup.set(idx, {
            productId: match.product?.productId ?? null,
            productName: match.product?.productName ?? null,
            productSku: match.product?.productSku ?? null,
            unitId: match.product?.unitId ?? null,
            unitName: match.product?.unitName ?? match.product?.unitAbbreviation ?? null,
            unitEquivalence: match.product?.unitEquivalence ?? null,
            source: match.product ? match.source : null,
          });
        });
      }

      const subtotal = textractResult.invoice.subtotal ?? 0;
      const iva = textractResult.invoice.taxAmount ?? 0;
      const total = textractResult.invoice.total ?? subtotal + iva;
      const linesSum =
        Math.abs(normalized.linesSum + iva - total) <= 100
          ? normalized.linesSum + iva
          : normalized.linesSum;

      const draft = {
        supplier: {
          name: normalized.supplier.name,
          nit: normalized.supplier.nit,
          confidence: textractResult.invoice.supplierName ? 0.92 : 0.55,
        },
        providerId: await findProviderIdForInvoice(ctx.db, ctx.tenantId, normalized.supplier),
        invoiceNumber: {
          value: normalized.invoiceNumber ?? '',
          confidence: textractResult.invoice.invoiceNumber ? 0.9 : 0.5,
        },
        lines: textractResult.invoice.lines.map((line, idx) => {
          const match = matchedLookup.get(idx);
          return {
            description: line.description,
            quantity: line.quantity ?? 1,
            unitPrice: line.unitPrice ?? 0,
            matchedProductId: match?.productId ?? null,
            matchedProductName: match?.productName ?? null,
            matchedProductSku: match?.productSku ?? null,
            unitId: match?.unitId ?? null,
            unitName: match?.unitName ?? null,
            unitEquivalence: match?.unitEquivalence ?? null,
            matchedBy: match?.source ?? null,
            confidence: match?.productId ? 0.88 : 0.7,
          };
        }),
        totals: {
          subtotal,
          iva,
          total,
          linesSum,
        },
        warnings: [] as string[],
        meta: {
          costUsd: textractResult.costUsd,
          latencyMs: textractResult.durationMs,
          provider: textractResult.provider,
        },
        uploadId: upload.id,
        extractAuditId: aiAuditLogId,
      };

      // Chain head read + row insert + head upsert must share one
      // transaction; a raw db here would leave a stale head on a crash
      // between the two writes.
      const uploadAuditId = ctx.db.transaction(tx =>
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: userId,
          action: 'ai.invoice_ocr.extract',
          resourceType: 'ai_feature',
          resourceId: upload.id,
          metadata: {
            provider: textractResult.provider,
            costUsd: textractResult.costUsd,
            latencyMs: textractResult.durationMs,
            model: textractResult.model,
            aiAuditLogId,
            payloadHash: upload.payloadHash,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
            ivaRate: normalized.ivaRate,
            lineCount: draft.lines.length,
            matchedLineCount: draft.lines.filter(l => l.matchedProductId).length,
          },
        })
      );

      return { ...draft, uploadAuditId };
    }),

  confirm: managerOrAdminProcedure
    .input(confirmInvoiceDraftInput)
    .mutation(async ({ ctx, input }) => {
      const settings = await resolveAISettings(ctx.db, ctx.tenantId);
      if (!settings.enabled || settings.features?.invoiceOcr.enabled !== true) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'AI_DISABLED',
          message: 'Invoice OCR is disabled for this tenant',
        });
      }

      const siteId = ctx.siteId;
      if (!siteId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Select an active site before confirming an invoice',
        });
      }

      if (Math.abs(input.totals.total - input.totals.linesSum) > 100) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invoice totals do not match the reviewed line totals',
        });
      }

      const upload = await ctx.db
        .select({
          id: invoiceUploads.id,
          payloadHash: invoiceUploads.payloadHash,
          mimeType: invoiceUploads.mimeType,
          sizeBytes: invoiceUploads.sizeBytes,
        })
        .from(invoiceUploads)
        .where(
          and(
            eq(invoiceUploads.id, input.uploadId),
            eq(invoiceUploads.tenantId, ctx.tenantId),
            eq(invoiceUploads.siteId, siteId)
          )
        )
        .get();

      if (!upload) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invoice upload not found',
        });
      }

      const purchase = await createOcrDraftPurchase(
        { ...ctx, user: ctx.user! },
        {
          providerId: input.providerId,
          items: input.lines.map(line => ({
            productId: line.matchedProductId,
            unitId: line.unitId,
            quantity: line.quantity,
            costPerUnit: line.unitPrice,
          })),
          notes: [
            'OCR invoice draft',
            input.invoiceNumber ? `Invoice ${input.invoiceNumber}` : null,
            input.supplier.name ? `Supplier ${input.supplier.name}` : null,
          ]
            .filter((part): part is string => part !== null)
            .join(' · '),
        }
      );

      const userId = ctx.user!.id;
      // Same transactional requirement as the extract audit above.
      ctx.db.transaction(tx =>
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: userId,
          action: 'ai.invoice_ocr.confirm',
          resourceType: 'ai_feature',
          resourceId: input.uploadId,
          metadata: {
            extractAuditId: input.extractAuditId,
            purchaseId: purchase.id,
            purchaseNumber: purchase.purchaseNumber,
            supplierName: input.supplier.name,
            supplierNit: input.supplier.nit,
            invoiceNumber: input.invoiceNumber,
            subtotal: input.totals.subtotal,
            total: input.totals.total,
            linesSum: input.totals.linesSum,
            payloadHash: upload.payloadHash,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
            lineCount: input.lines.length,
            matchedLineCount: input.lines.length,
          },
        })
      );
      return { ok: true as const, purchase };
    }),
});
