/**
 * VAT Rates Zod Schemas
 *
 * Input/output validation schemas for VAT rate tRPC procedures.
 *
 * @module trpc/schemas/vatRates
 */

import { z } from 'zod';
import { paginationInput } from './common.js';

export const listVatRatesInput = paginationInput.extend({
  search: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const getVatRateInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createVatRateInput = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  rate: z.number().min(0, 'Rate must be non-negative').max(100, 'Rate cannot exceed 100'),
  isActive: z.boolean().default(true),
});

export const updateVatRateInput = z.object({
  id: z.string().min(1, 'ID is required'),
  name: z.string().min(1).max(255).optional(),
  rate: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const deleteVatRateInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const searchVatRatesInput = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.number().int().min(1).max(50).default(20),
});

export type ListVatRatesInput = z.infer<typeof listVatRatesInput>;
export type CreateVatRateInput = z.infer<typeof createVatRateInput>;
export type UpdateVatRateInput = z.infer<typeof updateVatRateInput>;
export type SearchVatRatesInput = z.infer<typeof searchVatRatesInput>;
