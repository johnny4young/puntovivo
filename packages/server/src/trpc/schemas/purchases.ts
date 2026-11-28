/**
 * Purchases Zod Schemas
 *
 * Input/output validation schemas for purchase tRPC procedures
 *
 * @module trpc/schemas/purchases
 */

import { z } from 'zod';
import { isoDateField, paginationInput } from './common.js';

export const purchaseStatusEnum = z.enum([
  'draft',
  'completed',
  'partial_returned',
  'returned',
  'voided',
]);

export const purchaseDocumentTypeEnum = z.enum(['invoice', 'remision', 'other']);

/** Mirrors the invoice-OCR upload budget: a supporting paper for one
 * purchase never needs more headroom than the OCR intake allows. */
export const PURCHASE_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type PurchaseDocumentMimeType = (typeof PURCHASE_DOCUMENT_MIME_TYPES)[number];
export const PURCHASE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

const dataUrlPrefix = /^data:[^;]+;base64,/;

const purchaseDocumentTypeInput = purchaseDocumentTypeEnum.optional();
const purchaseDocumentNumberInput = z
  .string()
  .trim()
  .min(1, 'Document number cannot be empty when provided')
  .max(120)
  .optional();

const lotExpiryInput = isoDateField('Expiry must be a valid date');

export const purchaseLotReceiptInput = z.object({
  lotNumber: z.string().trim().min(1, 'Lot number is required').max(120),
  expiresAt: lotExpiryInput.nullable().optional(),
  /** Quantity attributed to this batch in the product's base unit. */
  baseQuantity: z.number().finite().positive('Lot quantity must be greater than zero'),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const purchaseItemInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  unitId: z.string().min(1, 'Unit ID is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
  costPerUnit: z.number().min(0, 'Cost per unit must be non-negative'),
  serialNumbers: z.array(z.string().trim().min(1)).max(500).optional(),
  lotReceipts: z.array(purchaseLotReceiptInput).min(1).max(50).optional(),
});

export const receiveOrderItemInput = z.object({
  orderItemId: z.string().min(1, 'Order item ID is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
  serialNumbers: z.array(z.string().trim().min(1)).max(500).optional(),
  lotReceipts: z.array(purchaseLotReceiptInput).min(1).max(50).optional(),
});

export const listPurchasesInput = paginationInput.extend({
  providerId: z.string().optional(),
  status: purchaseStatusEnum.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const getPurchaseInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createPurchaseInput = z.object({
  providerId: z.string().min(1, 'Provider is required'),
  items: z.array(purchaseItemInput).min(1, 'At least one item is required'),
  notes: z.string().optional(),
  documentType: purchaseDocumentTypeInput,
  documentNumber: purchaseDocumentNumberInput,
});

export const createPurchaseFromOrderInput = z.object({
  orderId: z.string().min(1, 'Order is required'),
  items: z.array(receiveOrderItemInput).min(1, 'At least one received item is required').optional(),
  notes: z.string().optional(),
  documentType: purchaseDocumentTypeInput,
  documentNumber: purchaseDocumentNumberInput,
});

export const setPurchaseDocumentInput = z.object({
  purchaseId: z.string().min(1, 'Purchase ID is required'),
  documentType: purchaseDocumentTypeInput,
  documentNumber: purchaseDocumentNumberInput,
});

export const attachPurchaseDocumentInput = z.object({
  purchaseId: z.string().min(1, 'Purchase ID is required'),
  fileName: z.string().trim().min(1).max(240).optional(),
  mimeType: z.enum(PURCHASE_DOCUMENT_MIME_TYPES),
  documentBase64: z
    .string()
    .min(1)
    .max(Math.ceil(PURCHASE_DOCUMENT_MAX_BYTES * 1.4) + 32 * 1024)
    .transform(value => value.replace(dataUrlPrefix, '')),
});

export const getPurchaseDocumentInput = z.object({
  purchaseId: z.string().min(1, 'Purchase ID is required'),
});

export const voidPurchaseInput = z.object({
  id: z.string().min(1, 'ID is required'),
  reason: z.string().optional(),
});

export const returnPurchaseItemInput = z.object({
  purchaseItemId: z.string().min(1, 'Purchase item ID is required'),
  quantity: z.number().positive('Return quantity must be greater than zero'),
  serialIds: z.array(z.string().min(1)).max(500).optional(),
  lotAllocations: z
    .array(
      z.object({
        purchaseItemLotId: z.string().min(1),
        baseQuantity: z.number().finite().positive(),
      })
    )
    .min(1)
    .max(50)
    .optional(),
});

export const returnPurchaseInput = z.object({
  id: z.string().min(1, 'ID is required'),
  items: z.array(returnPurchaseItemInput).min(1, 'At least one return item is required'),
  reason: z.string().optional(),
});

export type PurchaseItemInput = z.infer<typeof purchaseItemInput>;
export type PurchaseLotReceiptInput = z.infer<typeof purchaseLotReceiptInput>;
export type ReceiveOrderItemInput = z.infer<typeof receiveOrderItemInput>;
export type ListPurchasesInput = z.infer<typeof listPurchasesInput>;
export type CreatePurchaseInput = z.infer<typeof createPurchaseInput>;
export type CreatePurchaseFromOrderInput = z.infer<typeof createPurchaseFromOrderInput>;
export type SetPurchaseDocumentInput = z.infer<typeof setPurchaseDocumentInput>;
export type AttachPurchaseDocumentInput = z.infer<typeof attachPurchaseDocumentInput>;
export type GetPurchaseDocumentInput = z.infer<typeof getPurchaseDocumentInput>;
export type VoidPurchaseInput = z.infer<typeof voidPurchaseInput>;
export type ReturnPurchaseItemInput = z.infer<typeof returnPurchaseItemInput>;
export type ReturnPurchaseInput = z.infer<typeof returnPurchaseInput>;
