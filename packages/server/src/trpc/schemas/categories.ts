/**
 * Categories Zod Schemas
 *
 * Input/output validation schemas for categories tRPC procedures
 *
 * @module trpc/schemas/categories
 */

import { z } from 'zod';
import { paginationInput } from './common.js';

// ============================================================================
// Input Schemas
// ============================================================================

export const listCategoriesInput = paginationInput.extend({
  search: z.string().optional(),
  parentId: z.string().optional(),
});

export const getCategoryInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createCategoryInput = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
  parentId: z.string().optional(),
});

export const updateCategoryInput = z.object({
  id: z.string().min(1, 'ID is required'),
  name: z.string().min(1, 'Name is required').max(255).optional(),
  description: z.string().optional(),
  parentId: z.string().nullable().optional(),
});

export const deleteCategoryInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export type ListCategoriesInput = z.infer<typeof listCategoriesInput>;
export type CreateCategoryInput = z.infer<typeof createCategoryInput>;
export type UpdateCategoryInput = z.infer<typeof updateCategoryInput>;
