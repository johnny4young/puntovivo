/**
 * Products Zod Schemas
 *
 * Input/output validation schemas for products tRPC procedures
 *
 * @module trpc/schemas/products
 */

import { z } from 'zod';
import { paginationInput } from './common.js';
import { isUrlSchemeBlocked } from '../../lib/urlSafety.js';

/**
 * ENG-169 — product image: refine-only (no `.url()`) so existing
 * relative paths and `data:image/...` values keep validating, while
 * dangerous schemes (javascript:, data:text/html, …) are rejected at
 * the schema boundary. Nullable/optional pass through untouched.
 */
const productImageUrl = z
  .string()
  .refine(value => !isUrlSchemeBlocked(value), {
    message: 'URL scheme not permitted',
  })
  .nullable()
  .optional();

export const productUnitAssignmentInput = z.object({
  unitId: z.string().min(1, 'Unit is required'),
  equivalence: z.number().positive('Equivalence must be greater than zero'),
  price: z.number().min(0, 'Unit price must be non-negative'),
  isBase: z.boolean().default(false),
});

export const productProviderAssignmentInput = z.object({
  providerId: z.string().min(1, 'Provider is required'),
});

function hasDuplicateProviderAssignments(
  providerAssignments: Array<z.infer<typeof productProviderAssignmentInput>> | undefined
) {
  if (!providerAssignments) {
    return false;
  }

  const providerIds = providerAssignments.map(assignment => assignment.providerId);
  return new Set(providerIds).size !== providerIds.length;
}

// NOTE: Fraction policy business rules (step alignment, minimum >= step, etc.)
// live in `services/fraction-policy.ts` as the single source of truth. The
// Zod layer intentionally enforces only shape (numbers, nullability, >= 0) so
// the two layers never drift. The router calls `resolveFractionPolicy` which
// throws a coded TRPCError for any rule violation.

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

export const createProductInput = z
  .object({
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
    // Phase 1 DB-050: stock accepts real numbers so ferreterías (2.5 m cable)
    // and supermarkets (0.75 kg produce) can track fractional quantities.
    stock: z.number().min(0).default(0),
    minStock: z.number().min(0).default(0),
    sellByFraction: z.boolean().default(false),
    fractionStep: z.number().positive('Fraction step must be greater than zero').nullable().optional(),
    fractionMinimum: z
      .number()
      .positive('Fraction minimum must be greater than zero')
      .nullable()
      .optional(),
    isActive: z.boolean().default(true),
    barcode: z.string().nullable().optional(),
    imageUrl: productImageUrl,
    unitAssignments: z
      .array(productUnitAssignmentInput)
      .min(1, 'At least one unit assignment is required')
      .optional(),
    providerAssignments: z.array(productProviderAssignmentInput).optional(),
  })
  .superRefine((input, ctx) => {
    if (hasDuplicateProviderAssignments(input.providerAssignments)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Each provider can only be assigned once per product',
        path: ['providerAssignments'],
      });
    }
  });

export const updateProductInput = z
  .object({
    id: z.string().min(1, 'ID is required'),
    // ENG-177a — optimistic-concurrency token (see updateCustomerInput).
    version: z.number().int().nonnegative(),
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
    // Phase 1 DB-050: see createProductInput above.
    stock: z.number().min(0).optional(),
    minStock: z.number().min(0).optional(),
    sellByFraction: z.boolean().optional(),
    fractionStep: z.number().positive('Fraction step must be greater than zero').nullable().optional(),
    fractionMinimum: z
      .number()
      .positive('Fraction minimum must be greater than zero')
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
    barcode: z.string().nullable().optional(),
    imageUrl: productImageUrl,
    unitAssignments: z
      .array(productUnitAssignmentInput)
      .min(1, 'At least one unit assignment is required')
      .optional(),
    providerAssignments: z.array(productProviderAssignmentInput).optional(),
  })
  .superRefine((input, ctx) => {
    if (hasDuplicateProviderAssignments(input.providerAssignments)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Each provider can only be assigned once per product',
        path: ['providerAssignments'],
      });
    }
  });

export const deleteProductInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const searchProductsInput = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.number().int().min(1).max(50).default(20),
  categoryId: z.string().optional(),
  providerId: z.string().optional(),
  isActive: z.boolean().optional(),
});

// ENG-061 — exact-match scanner lookup. Distinct from `searchProductsInput`
// because the scanner pipeline needs deterministic resolution (no
// substring false positives) plus GS1-aware decoding.
export const lookupByBarcodeInput = z.object({
  barcode: z.string().min(1).max(64),
  /**
   * `strict` (default) rejects known digit-only symbologies whose
   * checksum fails. Unknown symbologies still attempt verbatim exact
   * lookup so basic Code128 / short internal barcodes keep working.
   */
  parsePolicy: z.enum(['strict', 'permissive']).default('strict'),
  gs1Scheme: z.enum(['none', 'generic', 'co', 'mx', 'cl']).default('generic'),
});

export type ListProductsInput = z.infer<typeof listProductsInput>;
export type CreateProductInput = z.infer<typeof createProductInput>;
export type UpdateProductInput = z.infer<typeof updateProductInput>;
export type SearchProductsInput = z.infer<typeof searchProductsInput>;
export type LookupByBarcodeInput = z.infer<typeof lookupByBarcodeInput>;
