/** UTC-normalized bounded contracts; scheduling never accepts client-provided financial data. */
import { z } from 'zod';
import { reservationStatusEnum } from '../../db/schema.js';
const id = z.string().trim().min(1).max(128);
const timestamp = z.iso
  .datetime({ offset: true })
  .transform(value => new Date(value).toISOString());
const version = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
export const reservationSiteInput = z.object({ siteId: id }).strict();
export const reservationTargetInput = reservationSiteInput.extend({ id });
const details = {
  tableId: id.nullable().default(null),
  guestName: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).nullable().optional(),
  partySize: z.number().int().min(1).max(200),
  startsAt: timestamp,
  endsAt: timestamp,
  notes: z.string().trim().max(500).nullable().optional(),
};
function validWindow(value: { startsAt: string; endsAt: string }) {
  const duration = Date.parse(value.endsAt) - Date.parse(value.startsAt);
  return duration > 0 && duration <= 24 * 60 * 60 * 1000;
}
export const createReservationInput = reservationSiteInput
  .extend(details)
  .refine(validWindow, { message: 'Reservation duration must be positive and at most 24 hours' });
export const updateReservationInput = reservationTargetInput
  .extend({ ...details, expectedVersion: version })
  .refine(validWindow, { message: 'Reservation duration must be positive and at most 24 hours' });
export const advanceReservationInput = reservationTargetInput
  .extend({
    expectedVersion: version,
    toStatus: z.enum(['arrived', 'cancelled', 'no_show']),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.toStatus !== 'arrived' && !value.reason)
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required' });
  });
export const listReservationsInput = reservationSiteInput
  .extend({
    from: timestamp,
    to: timestamp,
    status: z.enum(reservationStatusEnum).optional(),
    cursor: z.object({ startsAt: timestamp, id }).strict().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .refine(
    value => {
      const span = Date.parse(value.to) - Date.parse(value.from);
      return span > 0 && span <= 31 * 24 * 60 * 60 * 1000;
    },
    { message: 'Read window must be positive and at most 31 days' }
  );
/** New booking details, already bounded and converted to UTC. */
export type CreateReservationInput = z.infer<typeof createReservationInput>;
/** Full replace of a booked reservation; optimistic version prevents lost edits. */
export type UpdateReservationInput = z.infer<typeof updateReservationInput>;
/** Explicit arrival/cancel/no-show command; seating belongs to the sale writer. */
export type AdvanceReservationInput = z.infer<typeof advanceReservationInput>;
