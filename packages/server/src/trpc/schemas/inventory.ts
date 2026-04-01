/**
 * Inventory Zod Schemas
 *
 * Input/output validation schemas for inventory tRPC procedures
 *
 * @module trpc/schemas/inventory
 */

import { z } from 'zod';
import { paginationInput } from './common.js';

// ============================================================================
// Enums
// ============================================================================

export const movementTypeEnum = z.enum(['purchase', 'sale', 'adjustment', 'transfer', 'return']);

// ============================================================================
// Input Schemas
// ============================================================================

export const listMovementsInput = paginationInput.extend({
  productId: z.string().optional(),
  type: movementTypeEnum.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const getMovementInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createMovementInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  type: movementTypeEnum,
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

export const adjustStockInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  newStock: z.number().int().min(0, 'Stock must be non-negative'),
  notes: z.string().optional(),
});

export const productStockInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
});

export type ListMovementsInput = z.infer<typeof listMovementsInput>;
export type CreateMovementInput = z.infer<typeof createMovementInput>;
export type AdjustStockInput = z.infer<typeof adjustStockInput>;
