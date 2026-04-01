/**
 * Common Zod Schemas
 *
 * Reusable input schemas for pagination, sorting, and ID lookups.
 *
 * @module trpc/schemas/common
 */

import { z } from 'zod';

export const paginationInput = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(100).default(50),
});

export const idInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const searchInput = z.object({
  q: z.string().min(1, 'Search query is required'),
});

/** Shared sync queue helper — passed a db transaction or regular db */
export const syncOperationEnum = z.enum(['create', 'update', 'delete']);

export type PaginationInput = z.infer<typeof paginationInput>;
export type IdInput = z.infer<typeof idInput>;
