/**
 * Confirm one reviewed OCR extraction as a draft purchase. The extraction
 * link, sequential allocation, purchase, sync intent and audit trail share
 * one SQLite writer transaction so a retry cannot create another draft.
 *
 * @module application/purchases/confirmOcrDraftPurchase
 */
import { createHash } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  aiAuditLog,
  auditLogs,
  invoiceUploads,
  purchaseItems,
  purchases,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { resolveAISettingsInTransaction } from '../../services/ai/index.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { allocateNextSequential } from '../../services/sequential-allocation.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type { ConfirmInvoiceDraftInput } from '../../trpc/schemas/ai-vision.js';
import {
  getPurchaseSequentialContextInTransaction,
  getPurchaseSiteContextInTransaction,
  validateProviderInTransaction,
} from './helpers.js';
import { getPurchaseRecord } from './purchase-read.js';
import { resolvePurchaseItems } from './resolveItems.js';
import type { PurchaseContext } from './types.js';

function assertExtractionLink(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  input: ConfirmInvoiceDraftInput
) {
  const upload = db
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
        eq(invoiceUploads.tenantId, tenantId),
        eq(invoiceUploads.siteId, siteId)
      )
    )
    .get();
  if (!upload) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice upload not found' });
  }

  const extraction = db
    .select({ id: aiAuditLog.id })
    .from(aiAuditLog)
    .where(
      and(
        eq(aiAuditLog.id, input.extractAuditId),
        eq(aiAuditLog.tenantId, tenantId),
        eq(aiAuditLog.siteId, siteId),
        eq(aiAuditLog.feature, 'invoiceOcr'),
        isNull(aiAuditLog.errorCode)
      )
    )
    .get();
  const linkedAudit = extraction
    ? db
        .select({ metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.action, 'ai.invoice_ocr.extract'),
            eq(auditLogs.resourceType, 'ai_feature'),
            eq(auditLogs.resourceId, input.uploadId)
          )
        )
        .all()
        .some(
          row =>
            row.metadata?.aiAuditLogId === input.extractAuditId &&
            row.metadata.payloadHash === upload.payloadHash
        )
    : false;
  if (!linkedAudit) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice extraction not found' });
  }
  return upload;
}

export function confirmOcrDraftPurchase(ctx: PurchaseContext, input: ConfirmInvoiceDraftInput) {
  const siteId = ctx.siteId;
  if (!siteId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Select an active site before confirming an invoice',
    });
  }
  // Input is Zod-parsed by the router. Its stable shape includes every
  // reviewed field, not just the rows persisted in the purchase aggregate.
  const confirmationHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const db = ctx.db;
  const purchaseId = db.transaction(
    tx => {
      const writer = tx as unknown as DatabaseInstance;
      const existing = writer
        .select({
          id: purchases.id,
          siteId: purchases.siteId,
          confirmationHash: purchases.ocrConfirmationHash,
        })
        .from(purchases)
        .where(
          and(
            eq(purchases.tenantId, ctx.tenantId),
            eq(purchases.ocrExtractAuditId, input.extractAuditId)
          )
        )
        .get();
      if (existing) {
        if (existing.siteId !== siteId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice extraction not found' });
        }
        if (existing.confirmationHash !== confirmationHash) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This invoice extraction was confirmed with different reviewed data',
          });
        }
        return existing.id;
      }

      const settings = resolveAISettingsInTransaction(writer, ctx.tenantId);
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
      const upload = assertExtractionLink(writer, ctx.tenantId, siteId, input);
      validateProviderInTransaction(writer, ctx.tenantId, input.providerId);
      const sequentialContext = getPurchaseSequentialContextInTransaction(
        writer,
        ctx.tenantId,
        siteId
      );
      const purchaseSite = getPurchaseSiteContextInTransaction(
        writer,
        ctx.tenantId,
        siteId,
        sequentialContext.siteId
      );
      // OCR confirmation has no lot identity. It creates a draft without stock
      // movement; receipt will require the missing lot/serial details.
      const resolvedItems = resolvePurchaseItems(
        writer,
        ctx.tenantId,
        input.lines.map(line => ({
          productId: line.matchedProductId,
          unitId: line.unitId,
          quantity: line.quantity,
          costPerUnit: line.unitPrice,
        })),
        { allowMissingReceipts: true }
      );
      const total = resolvedItems.subtotal;
      // The purchase stores the net line cost, not the tax-inclusive invoice
      // total. Do not let two self-consistent client totals hide a different
      // amount in the draft that the operator did not review.
      if (
        roundMoney(total - input.totals.subtotal) !== 0 ||
        roundMoney(roundMoney(input.totals.subtotal + input.totals.iva) - input.totals.total) !== 0
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Reviewed invoice totals do not match the purchase lines and tax',
        });
      }
      const now = new Date().toISOString();
      const id = nanoid();
      const purchaseNumber = allocateNextSequential(writer, {
        tenantId: ctx.tenantId,
        sequentialId: sequentialContext.id,
        updatedAt: now,
      }).number;
      const notes = [
        'OCR invoice draft',
        input.invoiceNumber ? `Invoice ${input.invoiceNumber}` : null,
        input.supplier.name ? `Supplier ${input.supplier.name}` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(' · ');

      writer
        .insert(purchases)
        .values({
          id,
          tenantId: ctx.tenantId,
          purchaseNumber,
          providerId: input.providerId,
          orderId: null,
          ocrExtractAuditId: input.extractAuditId,
          ocrConfirmationHash: confirmationHash,
          siteId: purchaseSite.id,
          status: 'draft',
          subtotal: total,
          total,
          notes,
          createdBy: ctx.user.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      for (const row of resolvedItems.rows) {
        writer
          .insert(purchaseItems)
          .values({
            id: row.id,
            purchaseId: id,
            productId: row.productId,
            quantity: row.quantity,
            unitId: row.unitId,
            unitEquivalence: row.unitEquivalence,
            costPerUnit: row.costPerUnit,
            baseUnitCost: row.baseUnitCost,
            total: row.total,
          })
          .run();
      }
      enqueueSyncInTransaction(
        { ...ctx, db: writer },
        {
          entityType: 'purchases',
          entityId: id,
          operation: 'create',
          data: {
            id,
            purchaseNumber,
            providerId: input.providerId,
            total,
            siteId: purchaseSite.id,
            status: 'draft',
          },
        }
      );
      writeAuditLog({
        tx: writer,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'ai.invoice_ocr.confirm',
        resourceType: 'ai_feature',
        resourceId: input.uploadId,
        metadata: {
          extractAuditId: input.extractAuditId,
          purchaseId: id,
          purchaseNumber,
          supplierName: input.supplier.name,
          supplierNit: input.supplier.nit,
          invoiceNumber: input.invoiceNumber,
          subtotal: input.totals.subtotal,
          total: input.totals.total,
          linesSum: input.totals.linesSum,
          netCostReviewed: input.lines.every(line => line.netCostConfirmed),
          payloadHash: upload.payloadHash,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          lineCount: input.lines.length,
          matchedLineCount: input.lines.length,
        },
      });
      return id;
    },
    { behavior: 'immediate' }
  );
  return getPurchaseRecord(db, ctx.tenantId, purchaseId);
}
