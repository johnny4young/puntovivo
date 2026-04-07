/**
 * Sales Zod Schemas
 *
 * Input/output validation schemas for sales tRPC procedures
 *
 * @module trpc/schemas/sales
 */

import { z } from 'zod';
import { paginationInput } from './common.js';

// ============================================================================
// Enums
// ============================================================================

export const paymentMethodEnum = z.enum(['cash', 'card', 'transfer', 'credit', 'other']);
export const paymentStatusEnum = z.enum(['pending', 'paid', 'partial', 'refunded']);
export const saleStatusEnum = z.enum(['draft', 'completed', 'cancelled', 'voided']);

// ============================================================================
// Input Schemas
// ============================================================================

export const saleItemInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  unitId: z.string().min(1, 'Unit ID is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  unitPrice: z.number().min(0, 'Unit price must be non-negative'),
  discount: z.number().min(0).max(100).default(0),
  taxRate: z.number().min(0).max(100).optional(),
});

export const listSalesInput = paginationInput.extend({
  customerId: z.string().optional(),
  status: saleStatusEnum.optional(),
  paymentStatus: paymentStatusEnum.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const getSaleInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createSaleInput = z.object({
  customerId: z.string().optional(),
  items: z.array(saleItemInput).min(1, 'At least one item is required'),
  paymentMethod: paymentMethodEnum.default('cash'),
  paymentStatus: paymentStatusEnum.default('pending'),
  status: saleStatusEnum.default('completed'),
  notes: z.string().optional(),
  amountReceived: z.number().min(0).optional(),
  discountAmount: z.number().min(0).default(0),
});

export const updateSaleInput = z.object({
  id: z.string().min(1, 'ID is required'),
  paymentMethod: paymentMethodEnum.optional(),
  paymentStatus: paymentStatusEnum.optional(),
  notes: z.string().nullable().optional(),
});

export const voidSaleInput = z.object({
  id: z.string().min(1, 'ID is required'),
  reason: z.string().optional(),
});

export type SaleItemInput = z.infer<typeof saleItemInput>;
export type ListSalesInput = z.infer<typeof listSalesInput>;
export type CreateSaleInput = z.infer<typeof createSaleInput>;
export type UpdateSaleInput = z.infer<typeof updateSaleInput>;
export type VoidSaleInput = z.infer<typeof voidSaleInput>;
