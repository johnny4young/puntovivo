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
  description: z.string().optional(),
  categoryId: z.string().optional(),
  price: z.number().min(0, 'Price must be non-negative').default(0),
  cost: z.number().min(0, 'Cost must be non-negative').default(0),
  taxRate: z.number().min(0).max(100).default(0),
  stock: z.number().int().min(0).default(0),
  minStock: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  barcode: z.string().optional(),
  imageUrl: z.string().optional(),
});

export const updateProductInput = z.object({
  id: z.string().min(1, 'ID is required'),
  name: z.string().min(1).max(255).optional(),
  sku: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  price: z.number().min(0).optional(),
  cost: z.number().min(0).optional(),
  taxRate: z.number().min(0).max(100).optional(),
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
