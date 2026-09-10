import { z } from 'zod';
import { scheduleRecurrenceSchema } from '../../services/labor/schedule-recurrence.js';
const id = z.string().trim().min(1).max(100);
const title = z.string().trim().min(1).max(100);
const reason = z.string().trim().min(10).max(500);
export const createSchedulePlanInput = z
  .object({ title, recurrence: scheduleRecurrenceSchema })
  .strict();
export const getSchedulePlanInput = z.object({ id }).strict();
export const decideSchedulePlanInput = getSchedulePlanInput.extend({
  expectedVersion: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
});
export const regenerateSchedulePlanInput = decideSchedulePlanInput.extend({
  title,
  recurrence: scheduleRecurrenceSchema,
  reason,
});
export const discardSchedulePlanInput = decideSchedulePlanInput.extend({ reason });
export const listSchedulePlansInput = z
  .object({
    siteId: id,
    status: z.enum(['draft', 'published', 'discarded']).optional(),
    cursor: z.object({ createdAt: z.iso.datetime(), id }).strict().optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
/** A new, non-operative calendar snapshot; publication is a separate explicit decision. */
export type CreateSchedulePlanInput = z.infer<typeof createSchedulePlanInput>;
/** CAS guards stale dialogs and distinct attempts to activate the same draft. */
export type DecideSchedulePlanInput = z.infer<typeof decideSchedulePlanInput>;
/** Explicitly replace draft intent only, preserving the previous snapshot in private history. */
export type RegenerateSchedulePlanInput = z.infer<typeof regenerateSchedulePlanInput>;
/** Audited discard never deletes the draft or cancels any operational shift. */
export type DiscardSchedulePlanInput = z.infer<typeof discardSchedulePlanInput>;
/** One tenant-owned site and bounded keyset pagination, never an unbounded workforce dump. */
export type ListSchedulePlansInput = z.infer<typeof listSchedulePlansInput>;
