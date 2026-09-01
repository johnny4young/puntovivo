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
export const initialInventoryModeEnum = z.enum(['initial', 'physical']);
export const inventoryCountStatusEnum = z.enum(['counting', 'submitted', 'approved', 'rejected']);

// ============================================================================
// Input Schemas
// ============================================================================

export const listMovementsInput = paginationInput.extend({
  productId: z.string().optional(),
  siteId: z.string().min(1, 'Site ID is required').optional(),
  type: movementTypeEnum.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const listStockInput = paginationInput.extend({
  search: z.string().trim().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  lowStockOnly: z.boolean().optional(),
});

export const listEntriesInput = paginationInput.extend({
  productId: z.string().optional(),
  mode: initialInventoryModeEnum.optional(),
});

export const getMovementInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createMovementInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  type: movementTypeEnum,
  // movements accept fractional quantities.
  quantity: z.number().positive('Quantity must be greater than zero'),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

export const adjustStockInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  // adjustments accept fractional stock targets.
  newStock: z.number().min(0, 'Stock must be non-negative'),
  notes: z.string().optional(),
  // optional target site. When omitted, the router
  // falls back to `ctx.siteId` and finally the tenant primary site.
  siteId: z.string().min(1, 'Site ID is required').optional(),
});

export const recordEntryInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  unitId: z.string().min(1, 'Unit ID is required'),
  mode: initialInventoryModeEnum,
  quantity: z.number().positive('Quantity must be greater than zero'),
  cost: z.number().min(0, 'Cost must be non-negative'),
  notes: z.string().optional(),
});

export const productStockInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
});

export const listBalancesBySiteInput = z.object({
  siteId: z.string().min(1, 'Site ID is required'),
});

const uniqueProductIds = z
  .array(z.string().min(1, 'Product ID is required'))
  .min(1, 'Select at least one product')
  .max(500, 'A count session supports at most 500 products')
  .refine(ids => new Set(ids).size === ids.length, 'Products cannot be repeated');

export const createInventoryCountInput = z.object({
  siteId: z.string().min(1, 'Site ID is required'),
  productIds: uniqueProductIds,
  notes: z.string().trim().max(1_000).optional(),
});

export const listInventoryCountsInput = paginationInput.extend({
  siteId: z.string().min(1, 'Site ID is required').optional(),
  status: inventoryCountStatusEnum.optional(),
});

export const getInventoryCountInput = z.object({
  id: z.string().min(1, 'Count session ID is required'),
});

export const saveInventoryCountInput = getInventoryCountInput.extend({
  version: z.number().int().nonnegative(),
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1, 'Count line ID is required'),
        countedQuantity: z.number().finite().min(0, 'Counted quantity must be non-negative'),
        version: z.number().int().nonnegative(),
      })
    )
    .min(1, 'Record at least one counted quantity')
    .max(500)
    .refine(
      lines => new Set(lines.map(line => line.lineId)).size === lines.length,
      'Count lines cannot be repeated'
    ),
});

export const submitInventoryCountInput = getInventoryCountInput.extend({
  version: z.number().int().nonnegative(),
});
export const approveInventoryCountInput = getInventoryCountInput.extend({
  version: z.number().int().nonnegative(),
});
export const rejectInventoryCountInput = getInventoryCountInput.extend({
  version: z.number().int().nonnegative(),
  reason: z.string().trim().min(3, 'A rejection reason is required').max(500),
});

export const listReplenishmentSuggestionsInput = paginationInput.extend({
  siteId: z.string().min(1, 'Site ID is required'),
  search: z.string().trim().min(1).max(120).optional(),
});

// admin reconciliation has no input. The explicit
// empty object is declared here so every tRPC procedure has a schema anchor
// in this file, matching project convention.
export const reconcileBalancesInput = z.void().optional();

export type ListMovementsInput = z.infer<typeof listMovementsInput>;
export type ListStockInput = z.infer<typeof listStockInput>;
export type ListEntriesInput = z.infer<typeof listEntriesInput>;
export type CreateMovementInput = z.infer<typeof createMovementInput>;
export type AdjustStockInput = z.infer<typeof adjustStockInput>;
export type RecordEntryInput = z.infer<typeof recordEntryInput>;
export type CreateInventoryCountInput = z.infer<typeof createInventoryCountInput>;
export type ListInventoryCountsInput = z.infer<typeof listInventoryCountsInput>;
export type GetInventoryCountInput = z.infer<typeof getInventoryCountInput>;
export type SaveInventoryCountInput = z.infer<typeof saveInventoryCountInput>;
export type SubmitInventoryCountInput = z.infer<typeof submitInventoryCountInput>;
export type ApproveInventoryCountInput = z.infer<typeof approveInventoryCountInput>;
export type RejectInventoryCountInput = z.infer<typeof rejectInventoryCountInput>;
export type ListReplenishmentSuggestionsInput = z.infer<typeof listReplenishmentSuggestionsInput>;
