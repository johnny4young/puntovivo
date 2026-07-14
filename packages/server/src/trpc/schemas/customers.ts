/**
 * Customers Zod Schemas
 *
 * Input/output validation schemas for customers tRPC procedures
 *
 * @module trpc/schemas/customers
 */

import { z } from 'zod';
import { emailField, paginationInput } from './common.js';

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

export const exportCustomerPersonalDataInput = z
  .object({
    id: z.string().min(1, 'ID is required'),
  })
  .strict();

export const previewCustomerPrivacyDispositionInput = z
  .object({
    id: z.string().min(1, 'ID is required'),
  })
  .strict();

export const disposeCustomerPersonalDataInput = z
  .object({
    id: z.string().min(1, 'ID is required'),
    version: z.number().int().nonnegative(),
    confirmation: z.string().min(1, 'Confirmation is required'),
  })
  .strict();

// ENG-089 — `creditLimit` is the per-customer cupo de crédito. Zero
// is the explicit "no limit" sentinel; negative values are rejected
// here so the persistence layer never sees them. ENG-090 reads this
// to gate the "Cargar a cuenta" payment method against the running
// ledger balance.
const creditLimitSchema = z.number().nonnegative('creditLimit must be zero or greater').finite();

export const createCustomerInput = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  // ENG-169 — normalise (trim + lowercase) at the boundary.
  email: emailField('Invalid email address').optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  taxId: z.string().optional(),
  identificationTypeId: z.string().optional(),
  personTypeId: z.string().optional(),
  regimeTypeId: z.string().optional(),
  clientTypeId: z.string().optional(),
  commercialActivityId: z.string().optional(),
  notes: z.string().optional(),
  creditLimit: creditLimitSchema.optional(),
  isActive: z.boolean().default(true),
});

export const updateCustomerInput = z.object({
  id: z.string().min(1, 'ID is required'),
  // ENG-177a — optimistic-concurrency token; the client round-trips the
  // version it last read so a stale overwrite is rejected with STALE_VERSION.
  version: z.number().int().nonnegative(),
  name: z.string().min(1).max(255).optional(),
  email: emailField().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  taxId: z.string().nullable().optional(),
  identificationTypeId: z.string().nullable().optional(),
  personTypeId: z.string().nullable().optional(),
  regimeTypeId: z.string().nullable().optional(),
  clientTypeId: z.string().nullable().optional(),
  commercialActivityId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  creditLimit: creditLimitSchema.optional(),
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
