/**
 * Zod schemas for the inventory-lots router (Auditoría 2026-07).
 *
 * @module trpc/schemas/inventoryLots
 */

import { z } from 'zod';

/** ISO date (YYYY-MM-DD) or full ISO timestamp. */
const isoDate = z
  .string()
  .trim()
  .min(1)
  .refine(value => !Number.isNaN(Date.parse(value)), 'Must be a valid ISO date');

export const receiveLotInput = z.object({
  siteId: z.string().min(1, 'Site is required'),
  productId: z.string().min(1, 'Product is required'),
  lotNumber: z.string().trim().min(1, 'Lot number is required').max(120),
  expiresAt: isoDate.nullable().optional(),
  quantity: z.number().positive('Quantity must be greater than zero'),
  unitCost: z.number().min(0, 'Unit cost cannot be negative'),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const listLotsInput = z.object({
  siteId: z.string().min(1, 'Site is required'),
  productId: z.string().min(1, 'Product is required'),
  activeOnly: z.boolean().default(false),
});

export const expiringLotsInput = z.object({
  /** Look-ahead window in days from now (default 30). */
  withinDays: z.number().int().min(0).max(3650).default(30),
  siteId: z.string().min(1).optional(),
});

/** radar CTA: the lot to suggest a discount for. The percent is
 * computed server-side from the expiry tiers; the client never sends it. */
export const suggestDiscountInput = z.object({
  lotId: z.string().min(1, 'Lot id is required'),
});

/** retire an active suggestion from the radar. */
export const dismissSuggestionInput = z.object({
  suggestionId: z.string().min(1, 'Suggestion id is required'),
});

/** POS badge / radar read of active suggestions. */
export const activeSuggestionsInput = z
  .object({
    siteId: z.string().min(1).optional(),
  })
  .optional();

export type ReceiveLotInputSchema = z.infer<typeof receiveLotInput>;
export type ListLotsInputSchema = z.infer<typeof listLotsInput>;
export type ExpiringLotsInputSchema = z.infer<typeof expiringLotsInput>;
export type SuggestDiscountInputSchema = z.infer<typeof suggestDiscountInput>;
export type DismissSuggestionInputSchema = z.infer<typeof dismissSuggestionInput>;
export type ActiveSuggestionsInputSchema = z.infer<typeof activeSuggestionsInput>;
