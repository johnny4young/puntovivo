import { z } from 'zod';
import { SHIFT_SWAP_STATUSES } from '../../db/schema/shiftSwaps.js';
const id = z.string().trim().min(1).max(100);
const version = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER - 1);
const reason = z.string().trim().min(10).max(500);
export const createShiftSwapInput = z
  .object({
    offeredShiftId: id,
    requestedShiftId: id,
    offeredVersion: version,
    requestedVersion: version,
    reason,
  })
  .strict();
const decision = z.object({ id, expectedVersion: version }).strict();
const accept = decision.extend({ status: z.literal('accepted') });
const approve = decision.extend({ status: z.literal('approved') });
const reject = decision.extend({ status: z.literal('rejected'), reason });
const cancel = decision.extend({ status: z.literal('cancelled'), reason });
export const respondShiftSwapInput = z.discriminatedUnion('status', [accept, reject, cancel]);
export const decideShiftSwapInput = z.discriminatedUnion('status', [approve, reject]);
export const advanceShiftSwapInput = z.discriminatedUnion('status', [
  accept,
  approve,
  reject,
  cancel,
]);
const requestCursor = z.object({ createdAt: z.iso.datetime(), id }).strict();
const shiftCursor = z.object({ startsAt: z.iso.datetime(), id }).strict();
export const listMyShiftSwapsInput = z
  .object({
    status: z.enum(SHIFT_SWAP_STATUSES).optional(),
    cursor: requestCursor.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const listManagerShiftSwapsInput = z
  .object({
    status: z.enum(['requested', 'accepted']).optional(),
    cursor: requestCursor.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const listMySwappableShiftsInput = z
  .object({
    cursor: shiftCursor.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const listShiftSwapCandidatesInput = z
  .object({
    offeredShiftId: id,
    offeredVersion: version,
    cursor: shiftCursor.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const listShiftSwapEventsInput = z
  .object({
    id,
    beforeVersion: version.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
/** Both versions are captured by the employee, not silently refreshed by the server. */
export type CreateShiftSwapInput = z.infer<typeof createShiftSwapInput>;
/** Explicit counterpart consent or independent manager decision; no implicit acceptance. */
export type AdvanceShiftSwapInput = z.infer<typeof advanceShiftSwapInput>;
/** Participant-only history page; generic employee reads never expose unrelated requests. */
export type ListMyShiftSwapsInput = z.infer<typeof listMyShiftSwapsInput>;
/** Pending manager inbox with the same role ceiling as the approval command. */
export type ListManagerShiftSwapsInput = z.infer<typeof listManagerShiftSwapsInput>;
/** Future unclaimed shifts owned by the authenticated employee. */
export type ListMySwappableShiftsInput = z.infer<typeof listMySwappableShiftsInput>;
/** Future peer shifts, bound to the selected offered shift version. */
export type ListShiftSwapCandidatesInput = z.infer<typeof listShiftSwapCandidatesInput>;
/** Private transition history for a participant or authorized manager. */
export type ListShiftSwapEventsInput = z.infer<typeof listShiftSwapEventsInput>;
