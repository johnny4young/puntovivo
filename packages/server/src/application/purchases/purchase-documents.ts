/**
 * Purchase document attachments and purchase document identity.
 *
 * A purchase receipt is backed by a paper: usually a remisión that travels
 * with the goods, sometimes the supplier's final invoice. This use-case
 * records which document backs a purchase, and stores one scan or photo of
 * it. The payload lives in the encrypted database on purpose: the existing
 * encrypted backup then covers the evidence with zero configuration.
 *
 * @module application/purchases/purchase-documents
 */
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';

import { purchases, purchaseDocuments } from '../../db/schema.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  PURCHASE_DOCUMENT_MAX_BYTES,
  type AttachPurchaseDocumentInput,
  type GetPurchaseDocumentInput,
  type SetPurchaseDocumentInput,
} from '../../trpc/schemas/purchases.js';

interface PurchaseDocumentContext {
  db: import('../../db/index.js').DatabaseInstance;
  tenantId: string;
  user: { id: string; role: string };
}

function requirePurchase(
  db: PurchaseDocumentContext['db'],
  tenantId: string,
  purchaseId: string
) {
  const purchase = db
    .select({ id: purchases.id })
    .from(purchases)
    .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, tenantId)))
    .get();
  if (!purchase) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase not found' });
  }
}

/** Record or update which document backs a purchase. Absent fields are left
 * unchanged; this PR intentionally offers no "clear" path — clearing evidence
 * belongs with the consolidation follow-up. */
export function setPurchaseDocument(ctx: PurchaseDocumentContext, input: SetPurchaseDocumentInput) {
  requirePurchase(ctx.db, ctx.tenantId, input.purchaseId);

  const before = ctx.db
    .select({
      documentType: purchases.documentType,
      documentNumber: purchases.documentNumber,
    })
    .from(purchases)
    .where(and(eq(purchases.id, input.purchaseId), eq(purchases.tenantId, ctx.tenantId)))
    .get();

  if (input.documentType === undefined && input.documentNumber === undefined) {
    return { documentType: before?.documentType ?? null, documentNumber: before?.documentNumber ?? null };
  }

  const after = {
    documentType: input.documentType ?? before?.documentType ?? null,
    documentNumber: input.documentNumber ?? before?.documentNumber ?? null,
  };

  ctx.db.transaction(tx => {
    tx.update(purchases)
      .set({
        ...(input.documentType !== undefined ? { documentType: after.documentType } : {}),
        ...(input.documentNumber !== undefined ? { documentNumber: after.documentNumber } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(purchases.id, input.purchaseId), eq(purchases.tenantId, ctx.tenantId)))
      .run();
    writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: 'purchase.document_updated',
      resourceType: 'purchase',
      resourceId: input.purchaseId,
      before: before ?? null,
      after,
    });
  });

  return after;
}

/** Attach the scanned paper. One attachment per purchase; replacing it is a
 * deliberate admin action that belongs with the consolidation follow-up. */
export function attachPurchaseDocument(
  ctx: PurchaseDocumentContext,
  input: AttachPurchaseDocumentInput
) {
  const buffer = Buffer.from(input.documentBase64, 'base64');
  if (buffer.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Document payload is empty' });
  }
  if (buffer.length > PURCHASE_DOCUMENT_MAX_BYTES) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Document exceeds the ${Math.floor(PURCHASE_DOCUMENT_MAX_BYTES / (1024 * 1024))} MB limit`,
    });
  }

  requirePurchase(ctx.db, ctx.tenantId, input.purchaseId);

  const existing = ctx.db
    .select({ id: purchaseDocuments.id })
    .from(purchaseDocuments)
    .where(eq(purchaseDocuments.purchaseId, input.purchaseId))
    .get();
  if (existing) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This purchase already has an attached document',
    });
  }

  const payloadHash = createHash('sha256').update(buffer).digest('hex');
  const id = nanoid();
  const uploadedAt = new Date().toISOString();

  ctx.db.transaction(tx => {
    tx.insert(purchaseDocuments)
      .values({
        id,
        tenantId: ctx.tenantId,
        purchaseId: input.purchaseId,
        fileName: input.fileName ?? null,
        mimeType: input.mimeType,
        sizeBytes: buffer.length,
        payloadBase64: input.documentBase64,
        payloadHash,
        uploadedBy: ctx.user.id,
        createdAt: uploadedAt,
      })
      .run();
    writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: 'purchase.document_attached',
      resourceType: 'purchase',
      resourceId: input.purchaseId,
      before: null,
      after: {
        fileName: input.fileName ?? null,
        mimeType: input.mimeType,
        sizeBytes: buffer.length,
        payloadHash,
      },
    });
  });

  return { id, payloadHash, sizeBytes: buffer.length };
}

/** Fetch the attached paper for viewing or download, verifying the stored
 * hash before handing the payload back. */
export function getPurchaseDocument(ctx: PurchaseDocumentContext, input: GetPurchaseDocumentInput) {
  requirePurchase(ctx.db, ctx.tenantId, input.purchaseId);

  const document = ctx.db
    .select()
    .from(purchaseDocuments)
    .where(eq(purchaseDocuments.purchaseId, input.purchaseId))
    .get();
  if (!document) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase has no attached document' });
  }

  const actualHash = createHash('sha256')
    .update(Buffer.from(document.payloadBase64, 'base64'))
    .digest('hex');
  if (actualHash !== document.payloadHash) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Attached document failed integrity verification',
    });
  }

  return {
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    documentBase64: document.payloadBase64,
    payloadHash: document.payloadHash,
    uploadedBy: document.uploadedBy,
    createdAt: document.createdAt,
  };
}
