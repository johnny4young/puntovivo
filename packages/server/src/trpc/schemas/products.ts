/**
 * Products Zod Schemas
 *
 * Input/output validation schemas for products tRPC procedures
 *
 * @module trpc/schemas/products
 */

import { z } from 'zod';
import { paginationInput } from './common.js';

// ============================================================================
// Input Schemas
// ============================================================================

export const listProductsInput = paginationInput.extend({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const getProductInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createProductInput = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  sku: z.string().min(1, 'SKU is required').max(100),
  description: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  price: z.number().min(0, 'Price must be non-negative').default(0),
  price2: z.number().min(0, 'Price 2 must be non-negative').default(0),
  price3: z.number().min(0, 'Price 3 must be non-negative').default(0),
  cost: z.number().min(0, 'Cost must be non-negative').default(0),
  marginPercent1: z.number().min(0).default(0),
  marginPercent2: z.number().min(0).default(0),
  marginPercent3: z.number().min(0).default(0),
  marginAmount1: z.number().min(0).default(0),
  marginAmount2: z.number().min(0).default(0),
  marginAmount3: z.number().min(0).default(0),
  taxRate: z.number().min(0).max(100).default(0),
  vatRateId: z.string().nullable().optional(),
  providerId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  initialCost: z.number().min(0, 'Initial cost must be non-negative').default(0),
  stock: z.number().int().min(0).default(0),
  minStock: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  barcode: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
});

export const updateProductInput = z.object({
  id: z.string().min(1, 'ID is required'),
  name: z.string().min(1).max(255).optional(),
  sku: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  price: z.number().min(0).optional(),
  price2: z.number().min(0).optional(),
  price3: z.number().min(0).optional(),
  cost: z.number().min(0).optional(),
  marginPercent1: z.number().min(0).optional(),
  marginPercent2: z.number().min(0).optional(),
  marginPercent3: z.number().min(0).optional(),
  marginAmount1: z.number().min(0).optional(),
  marginAmount2: z.number().min(0).optional(),
  marginAmount3: z.number().min(0).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  vatRateId: z.string().nullable().optional(),
  providerId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  initialCost: z.number().min(0).optional(),
  stock: z.number().int().min(0).optional(),
  minStock: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  barcode: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
});

export const deleteProductInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const searchProductsInput = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.number().int().min(1).max(50).default(20),
});

export type ListProductsInput = z.infer<typeof listProductsInput>;
export type CreateProductInput = z.infer<typeof createProductInput>;
export type UpdateProductInput = z.infer<typeof updateProductInput>;
export type SearchProductsInput = z.infer<typeof searchProductsInput>;
