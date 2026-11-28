/**
 * Purchase document attachments and purchase document identity.
 *
 * Stores the supporting document type/number on a purchase and one verified
 * binary scan or photo in the encrypted SQLite database.
 *
 * @module application/purchases/purchase-documents
 */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';

import { purchases, purchaseDocuments } from '../../db/schema.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import {
  PURCHASE_DOCUMENT_MAX_BYTES,
  type AttachPurchaseDocumentInput,
  type GetPurchaseDocumentInput,
  type PurchaseDocumentMimeType,
  type SetPurchaseDocumentInput,
} from '../../trpc/schemas/purchases.js';

interface PurchaseDocumentContext {
  db: import('../../db/index.js').DatabaseInstance;
  tenantId: string;
  user: { id: string; role: string };
}

function matchesMimeSignature(buffer: Buffer, mimeType: PurchaseDocumentMimeType): boolean {
  switch (mimeType) {
    case 'application/pdf':
      return (
        buffer.length >= 5 &&
        buffer[0] === 0x25 && // %
        buffer[1] === 0x50 && // P
        buffer[2] === 0x44 && // D
        buffer[3] === 0x46 && // F
        buffer[4] === 0x2d // -
      );
    case 'image/png':
      return (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );
    case 'image/jpeg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/webp':
      return (
        buffer.length >= 12 &&
        buffer[0] === 0x52 && // R
        buffer[1] === 0x49 && // I
        buffer[2] === 0x46 && // F
        buffer[3] === 0x46 && // F
        buffer[8] === 0x57 && // W
        buffer[9] === 0x45 && // E
        buffer[10] === 0x42 && // B
        buffer[11] === 0x50 // P
      );
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (candidate.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  if (
    typeof candidate.message === 'string' &&
    /UNIQUE constraint failed/i.test(candidate.message)
  ) {
    return true;
  }
  return candidate.cause && candidate.cause !== error
    ? isUniqueConstraintError(candidate.cause)
    : false;
}

function requirePurchase(db: PurchaseDocumentContext['db'], tenantId: string, purchaseId: string) {
  const purchase = db
    .select({ id: purchases.id })
    .from(purchases)
    .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, tenantId)))
    .get();
  if (!purchase) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase not found' });
  }
}

/** Record or update which document backs a purchase; absent fields stay unchanged. */
export function setPurchaseDocument(ctx: PurchaseDocumentContext, input: SetPurchaseDocumentInput) {
  return ctx.db.transaction(
    tx => {
      requirePurchase(tx, ctx.tenantId, input.purchaseId);

      const before = tx
        .select({
          documentType: purchases.documentType,
          documentNumber: purchases.documentNumber,
        })
        .from(purchases)
        .where(and(eq(purchases.id, input.purchaseId), eq(purchases.tenantId, ctx.tenantId)))
        .get();

      if (input.documentType === undefined && input.documentNumber === undefined) {
        return {
          documentType: before?.documentType ?? null,
          documentNumber: before?.documentNumber ?? null,
        };
      }

      const after = {
        documentType: input.documentType ?? before?.documentType ?? null,
        documentNumber: input.documentNumber ?? before?.documentNumber ?? null,
      };

      tx.update(purchases)
        .set({
          ...(input.documentType !== undefined ? { documentType: after.documentType } : {}),
          ...(input.documentNumber !== undefined ? { documentNumber: after.documentNumber } : {}),
          syncStatus: 'pending',
          syncVersion: sql`${purchases.syncVersion} + 1`,
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
      enqueueSyncInTransaction(
        { db: tx as unknown as typeof ctx.db, tenantId: ctx.tenantId },
        {
          entityType: 'purchases',
          entityId: input.purchaseId,
          operation: 'update',
          data: {
            id: input.purchaseId,
            documentType: after.documentType,
            documentNumber: after.documentNumber,
          },
        }
      );

      return after;
    },
    { behavior: 'immediate' }
  );
}

/** Attach one verified supporting document (PDF/image) to a purchase. */
export function attachPurchaseDocument(
  ctx: PurchaseDocumentContext,
  input: AttachPurchaseDocumentInput
) {
  const cleaned = input.documentBase64.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Document payload is not valid base64' });
  }
  const buffer = Buffer.from(cleaned, 'base64');
  if (buffer.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Document payload is empty' });
  }
  if (buffer.length > PURCHASE_DOCUMENT_MAX_BYTES) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Document exceeds the ${Math.floor(PURCHASE_DOCUMENT_MAX_BYTES / (1024 * 1024))} MB limit`,
    });
  }
  if (!matchesMimeSignature(buffer, input.mimeType)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Document content does not match the declared file type',
    });
  }

  const payloadHash = createHash('sha256').update(buffer).digest('hex');
  const id = nanoid();
  const uploadedAt = new Date().toISOString();

  try {
    ctx.db.transaction(
      tx => {
        requirePurchase(tx, ctx.tenantId, input.purchaseId);

        const existing = tx
          .select({ id: purchaseDocuments.id })
          .from(purchaseDocuments)
          .where(
            and(
              eq(purchaseDocuments.tenantId, ctx.tenantId),
              eq(purchaseDocuments.purchaseId, input.purchaseId)
            )
          )
          .get();
        if (existing) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This purchase already has an attached document',
          });
        }

        tx.insert(purchaseDocuments)
          .values({
            id,
            tenantId: ctx.tenantId,
            purchaseId: input.purchaseId,
            fileName: input.fileName ?? null,
            mimeType: input.mimeType,
            sizeBytes: buffer.length,
            payload: buffer,
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
      },
      { behavior: 'immediate' }
    );
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (isUniqueConstraintError(error)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This purchase already has an attached document',
      });
    }
    throw error;
  }

  return { id, payloadHash, sizeBytes: buffer.length };
}

/** Fetch the attached document after verifying its stored SHA-256 hash. */
export function getPurchaseDocument(ctx: PurchaseDocumentContext, input: GetPurchaseDocumentInput) {
  requirePurchase(ctx.db, ctx.tenantId, input.purchaseId);

  const document = ctx.db
    .select()
    .from(purchaseDocuments)
    .where(
      and(
        eq(purchaseDocuments.tenantId, ctx.tenantId),
        eq(purchaseDocuments.purchaseId, input.purchaseId)
      )
    )
    .get();
  if (!document) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Purchase has no attached document' });
  }

  const actualHash = createHash('sha256').update(document.payload).digest('hex');
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
    documentBase64: document.payload.toString('base64'),
    payloadHash: document.payloadHash,
    uploadedBy: document.uploadedBy,
    createdAt: document.createdAt,
  };
}
