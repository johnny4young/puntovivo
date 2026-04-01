/**
 * Customers Zod Schemas
 *
 * Input/output validation schemas for customers tRPC procedures
 *
 * @module trpc/schemas/customers
 */

import { z } from 'zod';
import { paginationInput } from './common.js';

// ============================================================================
// Input Schemas
// ============================================================================

export const listCustomersInput = paginationInput.extend({
  search: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const getCustomerInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createCustomerInput = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  email: z.string().email('Invalid email address').optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  taxId: z.string().optional(),
  notes: z.string().optional(),
  isActive: z.boolean().default(true),
});

export const updateCustomerInput = z.object({
  id: z.string().min(1, 'ID is required'),
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  taxId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const deleteCustomerInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const searchCustomersInput = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.number().int().min(1).max(50).default(20),
});

export type ListCustomersInput = z.infer<typeof listCustomersInput>;
export type CreateCustomerInput = z.infer<typeof createCustomerInput>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerInput>;
export type SearchCustomersInput = z.infer<typeof searchCustomersInput>;
