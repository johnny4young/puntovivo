/** Site-scoped reservation self-management. Cashiers may host; viewers receive no guest PII. */
import { and, asc, desc, eq, gt, lt, or } from 'drizzle-orm';
import { restaurantReservations, reservationEvents } from '../../db/schema.js';
import {
  advanceReservation,
  createReservation,
  updateReservation,
} from '../../application/reservations/commands.js';
import { reservationError } from '../../application/reservations/invariants.js';
import { router } from '../init.js';
import { cashierManagerOrAdminProcedure } from '../middleware/roles.js';
import { createModuleGuard } from '../middleware/modules.js';
import { commandEnvelope, asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  advanceReservationInput,
  createReservationInput,
  listReservationsInput,
  reservationTargetInput,
  updateReservationInput,
} from '../schemas/reservations.js';
const read = cashierManagerOrAdminProcedure.use(createModuleGuard('dine-in'));
const command = read.use(commandEnvelope);
export const reservationsRouter = router({
  list: read.input(listReservationsInput).query(async ({ ctx, input }) => {
    const site = await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    if (!site.isActive) reservationError('missing');
    const rows = ctx.db
      .select()
      .from(restaurantReservations)
      .where(
        and(
          eq(restaurantReservations.tenantId, ctx.tenantId),
          eq(restaurantReservations.siteId, input.siteId),
          or(
            eq(restaurantReservations.status, 'arrived'),
            and(
              gt(restaurantReservations.endsAt, input.from),
              lt(restaurantReservations.startsAt, input.to)
            )
          ),
          ...(input.status ? [eq(restaurantReservations.status, input.status)] : []),
          ...(input.cursor
            ? [
                or(
                  gt(restaurantReservations.startsAt, input.cursor.startsAt),
                  and(
                    eq(restaurantReservations.startsAt, input.cursor.startsAt),
                    gt(restaurantReservations.id, input.cursor.id)
                  )
                ),
              ]
            : [])
        )
      )
      .orderBy(asc(restaurantReservations.startsAt), asc(restaurantReservations.id))
      .limit(input.limit + 1)
      .all();
    return { rows: rows.slice(0, input.limit), hasMore: rows.length > input.limit };
  }),
  get: read.input(reservationTargetInput).query(async ({ ctx, input }) => {
    const site = await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    if (!site.isActive) reservationError('missing');
    const row = ctx.db
      .select()
      .from(restaurantReservations)
      .where(
        and(
          eq(restaurantReservations.tenantId, ctx.tenantId),
          eq(restaurantReservations.siteId, input.siteId),
          eq(restaurantReservations.id, input.id)
        )
      )
      .get();
    if (!row) reservationError('missing');
    const events = ctx.db
      .select()
      .from(reservationEvents)
      .where(
        and(
          eq(reservationEvents.tenantId, ctx.tenantId),
          eq(reservationEvents.siteId, input.siteId),
          eq(reservationEvents.reservationId, row.id)
        )
      )
      .orderBy(desc(reservationEvents.version))
      .limit(100)
      .all();
    return { ...row, events };
  }),
  create: command.input(createReservationInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return createReservation(asCriticalCommandContext(ctx), input);
  }),
  update: command.input(updateReservationInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return updateReservation(asCriticalCommandContext(ctx), input);
  }),
  advance: command.input(advanceReservationInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return advanceReservation(asCriticalCommandContext(ctx), input);
  }),
});
