/**
 * Purchases Zod Schemas
 *
 * Input/output validation schemas for purchase tRPC procedures
 *
 * @module trpc/schemas/purchases
 */

import { z } from 'zod';
import { paginationInput } from './common.js';

export const purchaseStatusEnum = z.enum(['completed', 'voided']);

export const purchaseItemInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  unitId: z.string().min(1, 'Unit ID is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  costPerUnit: z.number().min(0, 'Cost per unit must be non-negative'),
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
});

export const createPurchaseFromOrderInput = z.object({
  orderId: z.string().min(1, 'Order is required'),
});

export const voidPurchaseInput = z.object({
  id: z.string().min(1, 'ID is required'),
  reason: z.string().optional(),
});

export type PurchaseItemInput = z.infer<typeof purchaseItemInput>;
export type ListPurchasesInput = z.infer<typeof listPurchasesInput>;
export type CreatePurchaseInput = z.infer<typeof createPurchaseInput>;
export type CreatePurchaseFromOrderInput = z.infer<typeof createPurchaseFromOrderInput>;
export type VoidPurchaseInput = z.infer<typeof voidPurchaseInput>;
