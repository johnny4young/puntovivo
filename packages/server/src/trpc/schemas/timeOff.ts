import { z } from 'zod';
import {
  TIME_OFF_KINDS,
  TIME_OFF_STATUSES,
  timeOffReasonSchema,
  timeOffWindowSchema,
} from '../../services/labor/time-off.js';
import { workforceDateSchema } from '../../services/labor/employment-contract.js';

const identifier = z.string().trim().min(1).max(100);
export const createTimeOffInput = timeOffWindowSchema.safeExtend({
  userId: identifier,
  siteId: identifier,
  kind: z.enum(TIME_OFF_KINDS),
  reason: timeOffReasonSchema,
});
export const getTimeOffInput = z.object({ id: identifier, siteId: identifier }).strict();
export const advanceTimeOffInput = getTimeOffInput.extend({
  expectedVersion: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
  status: z.enum(['approved', 'rejected', 'cancelled']),
  reason: timeOffReasonSchema,
});
export const listTimeOffInput = z
  .object({
    siteId: identifier.optional(),
    userId: identifier.optional(),
    status: z.enum(TIME_OFF_STATUSES).optional(),
    fromDate: workforceDateSchema.optional(),
    untilDate: workforceDateSchema.optional(),
    cursor: z.object({ createdAt: z.iso.datetime(), id: identifier }).strict().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      (input.fromDate || input.untilDate) &&
      !timeOffWindowSchema.safeParse({ fromDate: input.fromDate, untilDate: input.untilDate })
        .success
    )
      ctx.addIssue({
        code: 'custom',
        path: ['untilDate'],
        message: 'Provide both dates and a valid bounded period',
      });
  });
export const listTimeOffEventsInput = getTimeOffInput.extend({
  beforeVersion: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

/** A manager-authored request, not automatic approval or an attendance correction. */
export type CreateTimeOffInput = z.infer<typeof createTimeOffInput>;
/** Optimistic approval/rejection/cancellation of one immutable request interval. */
export type AdvanceTimeOffInput = z.infer<typeof advanceTimeOffInput>;
/** Stable keyset page; optional dates describe the request's frozen calendar dates. */
export type ListTimeOffInput = z.infer<typeof listTimeOffInput>;
