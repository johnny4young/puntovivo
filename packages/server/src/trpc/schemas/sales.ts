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
export const splitPaymentMethodEnum = z.enum(['cash', 'card', 'transfer', 'other']);
export const paymentStatusEnum = z.enum(['pending', 'paid', 'partial', 'refunded']);
export const saleStatusEnum = z.enum(['draft', 'completed', 'cancelled', 'voided']);

// ============================================================================
// Input Schemas
// ============================================================================

export const saleItemInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  unitId: z.string().min(1, 'Unit ID is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
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

/**
 * One tender applied to a sale. Split-payment sales supply an array of these;
 * single-tender sales use the legacy `paymentMethod` + `amountReceived`
 * fields, which the server normalizes into a single payment row. Credit sales
 * stay on the legacy path until Phase 5 adds on-account balances and abonos.
 */
export const salePaymentInput = z.object({
  method: splitPaymentMethodEnum,
  amount: z
    .number()
    .finite('Amount must be a finite number')
    .positive('Amount must be greater than zero'),
  reference: z.string().trim().max(120).optional(),
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
  /**
   * Phase 2 Tier-2 step 5 — optional multi-tender list. When present, the
   * server validates Σ(amount) ≈ total and persists a row per tender. The
   * legacy `paymentMethod` + `amountReceived` pair is ignored for
   * persistence in this mode but still echoed onto `sales.paymentMethod`
   * using the dominant tender so legacy consumers keep rendering.
   */
  payments: z.array(salePaymentInput).optional(),
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

export const returnSaleInput = z.object({
  id: z.string().min(1, 'ID is required'),
  reason: z.string().optional(),
});

export type SaleItemInput = z.infer<typeof saleItemInput>;
export type SalePaymentInput = z.infer<typeof salePaymentInput>;
export type ListSalesInput = z.infer<typeof listSalesInput>;
export type CreateSaleInput = z.infer<typeof createSaleInput>;
export type UpdateSaleInput = z.infer<typeof updateSaleInput>;
export type VoidSaleInput = z.infer<typeof voidSaleInput>;
export type ReturnSaleInput = z.infer<typeof returnSaleInput>;
