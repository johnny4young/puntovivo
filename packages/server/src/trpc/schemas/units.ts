/**
 * Units Zod Schemas
 *
 * Input/output validation schemas for unit tRPC procedures.
 *
 * @module trpc/schemas/units
 */

import { z } from 'zod';
import { paginationInput } from './common.js';
import { unitDimensionEnum } from '../../db/schema/base.js';

// Auditoría 2026-07 — units foundation. All optional so existing clients
// (and the desktop offline path) keep working unchanged; when omitted on
// create, the router backfills them from the standards catalog.
const unitDimensionSchema = z.enum(unitDimensionEnum);
const standardCodeSchema = z.string().trim().min(1).max(12);
const referenceFactorSchema = z.number().positive().finite();

export const listUnitsInput = paginationInput.extend({
  search: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const getUnitInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const createUnitInput = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  abbreviation: z.string().min(1, 'Abbreviation is required').max(20),
  dimension: unitDimensionSchema.optional(),
  standardCode: standardCodeSchema.optional(),
  referenceFactor: referenceFactorSchema.optional(),
  isActive: z.boolean().default(true),
});

export const updateUnitInput = z.object({
  id: z.string().min(1, 'ID is required'),
  name: z.string().min(1).max(255).optional(),
  abbreviation: z.string().min(1).max(20).optional(),
  dimension: unitDimensionSchema.nullable().optional(),
  standardCode: standardCodeSchema.nullable().optional(),
  referenceFactor: referenceFactorSchema.nullable().optional(),
  isActive: z.boolean().optional(),
});

export const deleteUnitInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const searchUnitsInput = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.number().int().min(1).max(50).default(20),
});

export type ListUnitsInput = z.infer<typeof listUnitsInput>;
export type CreateUnitInput = z.infer<typeof createUnitInput>;
export type UpdateUnitInput = z.infer<typeof updateUnitInput>;
export type SearchUnitsInput = z.infer<typeof searchUnitsInput>;
