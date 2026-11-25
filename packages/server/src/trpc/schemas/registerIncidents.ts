/**
 * Zod schemas for incidents reported from the till.
 *
 * @module trpc/schemas/registerIncidents
 */
import { z } from 'zod';

import { registerIncidentKindEnum, registerIncidentReasonEnum } from '../../db/schema.js';

export const reportRegisterIncidentInput = z
  .object({
    kind: z.enum(registerIncidentKindEnum),
    productId: z.string().min(1).max(64).optional(),
    reason: z.enum(registerIncidentReasonEnum).optional(),
    shelfPrice: z.number().nonnegative().max(1_000_000_000).optional(),
    note: z.string().max(500).optional(),
  })
  .refine(value => value.kind !== 'price_mismatch' || value.shelfPrice !== undefined, {
    message: 'A price mismatch needs the shelf price',
    path: ['shelfPrice'],
  });

export const listOpenRegisterIncidentsInput = z
  .object({ siteId: z.string().min(1).max(64).optional() })
  .optional();

export const resolveRegisterIncidentInput = z.object({
  id: z.string().min(1).max(64),
  note: z.string().max(500).optional(),
});

export const registerIncidentProductStockInput = z.object({
  productId: z.string().min(1).max(64),
});
