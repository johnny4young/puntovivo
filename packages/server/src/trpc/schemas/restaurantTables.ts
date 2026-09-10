/**
 * input schemas for the `restaurantTables.*` router.
 *
 * Tables are scoped to `(tenantId, siteId)`. The list query takes a
 * required `siteId` so callers can render the catalog per active site.
 * Create / update payloads accept narrow strings with explicit `null`
 * for the nullable columns (`seatCount`, `area`, `notes`) so the
 * router can distinguish "operator cleared the field" from "operator
 * did not touch the field".
 *
 * @module trpc/schemas/restaurantTables
 */

import { z } from 'zod';

/** Maximum active physical tables one site may expose to operational clients. */
export const MAX_ACTIVE_RESTAURANT_TABLES_PER_SITE = 500;

export const listRestaurantTablesInput = z.object({
  siteId: z.string().min(1, 'siteId is required'),
  includeArchived: z.boolean().default(false),
  /** Literal name substring. SQL wildcard characters have no special meaning. */
  search: z.string().trim().max(80).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_ACTIVE_RESTAURANT_TABLES_PER_SITE)
    .default(MAX_ACTIVE_RESTAURANT_TABLES_PER_SITE),
  offset: z.number().int().min(0).default(0),
});
export type ListRestaurantTablesInput = z.infer<typeof listRestaurantTablesInput>;

export const getRestaurantTableByIdInput = z.object({
  id: z.string().min(1),
});
export type GetRestaurantTableByIdInput = z.infer<typeof getRestaurantTableByIdInput>;

const seatCountSchema = z.number().int().min(1).max(200).nullable();
const areaSchema = z.string().trim().max(80).nullable();
const notesSchema = z.string().trim().max(280).nullable();

export const createRestaurantTableInput = z.object({
  siteId: z.string().min(1),
  name: z.string().trim().min(1, 'name is required').max(80),
  seatCount: seatCountSchema.optional(),
  area: areaSchema.optional(),
  notes: notesSchema.optional(),
});
export type CreateRestaurantTableInput = z.infer<typeof createRestaurantTableInput>;

export const updateRestaurantTableInput = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  seatCount: seatCountSchema.optional(),
  area: areaSchema.optional(),
  notes: notesSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateRestaurantTableInput = z.infer<typeof updateRestaurantTableInput>;

export const archiveRestaurantTableInput = z.object({
  id: z.string().min(1),
});
export type ArchiveRestaurantTableInput = z.infer<typeof archiveRestaurantTableInput>;
