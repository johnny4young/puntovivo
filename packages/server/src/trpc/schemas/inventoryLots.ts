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

export type ReceiveLotInputSchema = z.infer<typeof receiveLotInput>;
export type ListLotsInputSchema = z.infer<typeof listLotsInput>;
export type ExpiringLotsInputSchema = z.infer<typeof expiringLotsInput>;
