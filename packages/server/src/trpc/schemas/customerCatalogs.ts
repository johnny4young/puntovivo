import { z } from 'zod';
import { paginationInput } from './common.js';

export const listCustomerCatalogItemsInput = paginationInput.extend({
  search: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const getCustomerCatalogItemInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createCustomerCatalogItemInput = z.object({
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const updateCustomerCatalogItemInput = z.object({
  id: z.string().min(1, 'ID is required'),
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const deleteCustomerCatalogItemInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const searchCustomerCatalogItemsInput = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.number().int().min(1).max(50).default(20),
  isActive: z.boolean().optional(),
});

export type ListCustomerCatalogItemsInput = z.infer<typeof listCustomerCatalogItemsInput>;
export type CreateCustomerCatalogItemInput = z.infer<typeof createCustomerCatalogItemInput>;
export type UpdateCustomerCatalogItemInput = z.infer<typeof updateCustomerCatalogItemInput>;
