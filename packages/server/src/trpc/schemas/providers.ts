/**
 * Providers Zod Schemas
 *
 * Input/output validation schemas for provider tRPC procedures.
 *
 * @module trpc/schemas/providers
 */

import { z } from 'zod';
import { paginationInput } from './common.js';

export const listProvidersInput = paginationInput.extend({
  search: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const getProviderInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createProviderInput = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  taxId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Invalid email address').optional(),
  address: z.string().optional(),
  cityId: z.string().optional(),
  contactName: z.string().optional(),
  isActive: z.boolean().default(true),
});

export const updateProviderInput = z.object({
  id: z.string().min(1, 'ID is required'),
  name: z.string().min(1).max(255).optional(),
  taxId: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().nullable().optional(),
  cityId: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const deleteProviderInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const listProviderCategoryAssignmentsInput = z.object({
  providerId: z.string().min(1, 'Provider ID is required'),
});

export const replaceProviderCategoryAssignmentsInput = z.object({
  providerId: z.string().min(1, 'Provider ID is required'),
  categoryIds: z.array(z.string().min(1, 'Category ID is required')),
});

export const searchProvidersInput = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.number().int().min(1).max(50).default(20),
});

export type ListProvidersInput = z.infer<typeof listProvidersInput>;
export type CreateProviderInput = z.infer<typeof createProviderInput>;
export type UpdateProviderInput = z.infer<typeof updateProviderInput>;
export type SearchProvidersInput = z.infer<typeof searchProvidersInput>;
export type ReplaceProviderCategoryAssignmentsInput = z.infer<
  typeof replaceProviderCategoryAssignmentsInput
>;
