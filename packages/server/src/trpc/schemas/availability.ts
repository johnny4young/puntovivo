import { z } from 'zod';
import {
  availabilityPeriodSchema,
  availabilitySlotsSchema,
} from '../../services/labor/availability.js';
import { workforceDateSchema } from '../../services/labor/employment-contract.js';
const id = z.string().trim().min(1).max(100),
  reason = z.string().trim().min(10).max(500);
export const createAvailabilityInput = availabilityPeriodSchema.safeExtend({
  userId: id,
  slots: availabilitySlotsSchema,
  reason,
});
export const getAvailabilityInput = z.object({ id }).strict();
export const voidAvailabilityInput = getAvailabilityInput.extend({
  expectedVersion: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
  reason,
});
export const replaceAvailabilityInput = voidAvailabilityInput.extend({
  fromDate: workforceDateSchema,
  slots: availabilitySlotsSchema,
});
export const listAvailabilityInput = z
  .object({
    userId: id.optional(),
    includeVoided: z.boolean().default(false),
    cursor: z.object({ createdAt: z.iso.datetime(), id }).strict().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export const listAvailabilityEventsInput = getAvailabilityInput.extend({
  beforeVersion: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
/** New explicit employee-global weekly policy. Empty slots mean unavailable, not unrestricted. */
export type CreateAvailabilityInput = z.infer<typeof createAvailabilityInput>;
/** Effective split of one policy. The successor inherits its predecessor's frozen zone and end. */
export type ReplaceAvailabilityInput = z.infer<typeof replaceAvailabilityInput>;
/** Audited removal of a configured restriction, never cancellation of scheduled shifts. */
export type VoidAvailabilityInput = z.infer<typeof voidAvailabilityInput>;
/** Stable bounded page with explicit inclusion of voided evidence. */
export type ListAvailabilityInput = z.infer<typeof listAvailabilityInput>;
