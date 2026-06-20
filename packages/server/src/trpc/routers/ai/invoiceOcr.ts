/**
 * AI router — invoice OCR sub-router (ENG-178 split).
 *
 * ENG-094 / AI Núcleo 2026-05-15 — `ai.invoiceOcr.{extract,confirm}`.
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
import { recordCall, resolveAISettings } from '../../../services/ai/index.js';
import { matchInvoiceLinesToProducts } from '../../../services/ai/vision/index.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { normalizeColombianInvoice } from '../../../services/ai/invoice/normalize-co.js';
import { extractInvoiceWithTextract } from '../../../services/ai/invoice/textract.js';
import { requireAiQuotaAvailable } from '../../../services/ai/quotas.js';
import { createOcrDraftPurchase } from '../../../application/purchases/index.js';
import { writeAuditLog } from '../../../services/audit-logs.js';
import {
  confirmInvoiceDraftInput,
  extractInvoiceOcrInput,
} from '../../schemas/ai-vision.js';
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
      // ENG-102 — per-site monthly quota check fires BEFORE the
      // OCR provider call so a blocked request never writes an
      // audit row. Bypass when the request has no site context.
      if (ctx.siteId) {
        await requireAiQuotaAvailable({
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          feature: 'invoiceOcr',
        });
      }

      const upload = await ctx.db
        .select()
        .from(invoiceUploads)
        .where(and(eq(invoiceUploads.id, input.uploadId), eq(invoiceUploads.tenantId, ctx.tenantId)))
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

      const result = await extractInvoiceWithTextract({
        documentBase64: upload.payloadBase64,
        mimeType: upload.mimeType as Parameters<typeof extractInvoiceWithTextract>[0]['mimeType'],
      });

      const { id: aiAuditLogId } = await recordCall(ctx.db, {
        tenantId: ctx.tenantId,
        siteId: ctx.siteId,
        userId,
        feature: 'invoiceOcr',
        providerId: result.provider,
        modelId: result.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        errorCode: null,
      });

      const normalized = normalizeColombianInvoice({
        supplierName: result.invoice.supplierName,
        supplierTaxId: result.invoice.supplierTaxId,
        invoiceNumber: result.invoice.invoiceNumber,
        subtotal: result.invoice.subtotal,
        taxAmount: result.invoice.taxAmount,
        lines: result.invoice.lines.map(l => ({ totalLine: l.totalLine })),
      });

      const lineMatches = result.invoice.lines.length
        ? await matchInvoiceLinesToProducts(
            { db: ctx.db, tenantId: ctx.tenantId, siteId: ctx.siteId, userId },
            result.invoice.lines.map(l => ({
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

      const subtotal = result.invoice.subtotal ?? 0;
      const iva = result.invoice.taxAmount ?? 0;
      const total = result.invoice.total ?? subtotal + iva;
      const linesSum =
        Math.abs(normalized.linesSum + iva - total) <= 100
          ? normalized.linesSum + iva
          : normalized.linesSum;

      const draft = {
        supplier: {
          name: normalized.supplier.name,
          nit: normalized.supplier.nit,
          confidence: result.invoice.supplierName ? 0.92 : 0.55,
        },
        providerId: await findProviderIdForInvoice(ctx.db, ctx.tenantId, normalized.supplier),
        invoiceNumber: {
          value: normalized.invoiceNumber ?? '',
          confidence: result.invoice.invoiceNumber ? 0.9 : 0.5,
        },
        lines: result.invoice.lines.map((line, idx) => {
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
          costUsd: result.costUsd,
          latencyMs: result.durationMs,
          provider: result.provider,
        },
        uploadId: upload.id,
        extractAuditId: aiAuditLogId,
      };

      const uploadAuditId = writeAuditLog({
        tx: ctx.db,
        tenantId: ctx.tenantId,
        actorId: userId,
        action: 'ai.invoice_ocr.extract',
        resourceType: 'ai_feature',
        resourceId: upload.id,
        metadata: {
          provider: result.provider,
          costUsd: result.costUsd,
          latencyMs: result.durationMs,
          model: result.model,
          aiAuditLogId,
          payloadHash: upload.payloadHash,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          ivaRate: normalized.ivaRate,
          lineCount: draft.lines.length,
          matchedLineCount: draft.lines.filter(l => l.matchedProductId).length,
        },
      });

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
        .where(and(eq(invoiceUploads.id, input.uploadId), eq(invoiceUploads.tenantId, ctx.tenantId)))
        .get();

      if (!upload) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invoice upload not found',
        });
      }

      const purchase = await createOcrDraftPurchase({ ...ctx, user: ctx.user! }, {
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
      });

      const userId = ctx.user!.id;
      writeAuditLog({
        tx: ctx.db,
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
      });
      return { ok: true as const, purchase };
    }),
});
