/**
 * Shift handoff router: hand the drawer over and receive it.
 *
 * @module trpc/routers/shiftHandoffs
 */
import { and, eq } from 'drizzle-orm';

import {
  handOutShift,
  listPendingHandoffs,
  previewHandOut,
  receiveShift,
} from '../../application/cash-sessions/handoff.js';
import type { CashSessionContext } from '../../application/cash-sessions/index.js';
import { users } from '../../db/schema.js';
import type { Context } from '../context.js';
import { router } from '../init.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { criticalCommandCashierManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import { cashierManagerOrAdminProcedure } from '../middleware/roles.js';
import {
  handOutPreviewInput,
  handOutShiftInput,
  receiveShiftInput,
} from '../schemas/shiftHandoffs.js';

function readContext(ctx: Context): CashSessionContext {
  return {
    db: ctx.db,
    tenantId: ctx.tenantId!,
    siteId: ctx.siteId,
    user: { id: ctx.user!.id, role: ctx.user!.role },
  };
}

function commandContext(ctx: Context): CashSessionContext {
  const cc = asCriticalCommandContext(ctx);
  return {
    db: cc.db,
    tenantId: cc.tenantId,
    siteId: cc.siteId,
    user: { id: cc.user.id, role: cc.user.role },
    envelope: cc.envelope,
    deviceId: cc.deviceId,
    log: cc.req?.server?.log,
  };
}

export const shiftHandoffsRouter = router({
  /** What the caller hands over: shift total, parked sales, open approvals and notices. */
  handOutPreview: cashierManagerOrAdminProcedure
    .input(handOutPreviewInput)
    .query(({ ctx, input }) =>
      ctx.siteId ? previewHandOut(readContext(ctx), input?.denominations ?? []) : null
    ),

  handOut: criticalCommandCashierManagerOrAdminProcedure
    .input(handOutShiftInput)
    .mutation(({ ctx, input }) =>
      handOutShift(commandContext(ctx), {
        actualCount: input.actualCount,
        denominations: input.denominations,
        note: input.note ?? null,
      })
    ),

  /** Drawers waiting at the active site, with whether the caller confirms by PIN. */
  pending: cashierManagerOrAdminProcedure.query(({ ctx }) => {
    if (!ctx.siteId) return { handoffs: [], pinRequired: false };
    const receiver = ctx.db
      .select({ staffPinHash: users.staffPinHash })
      .from(users)
      .where(and(eq(users.id, ctx.user!.id), eq(users.tenantId, ctx.tenantId)))
      .get();
    return {
      handoffs: listPendingHandoffs(readContext(ctx)).filter(
        handoff => handoff.fromUserId !== ctx.user!.id
      ),
      pinRequired: Boolean(receiver?.staffPinHash),
    };
  }),

  receive: criticalCommandCashierManagerOrAdminProcedure
    .input(receiveShiftInput)
    .mutation(async ({ ctx, input }) => {
      const result = await receiveShift(commandContext(ctx), {
        handoffId: input.handoffId,
        mode: input.mode,
        denominations: input.denominations,
        pin: input.pin ?? null,
      });
      return {
        handoffId: result.handoffId,
        sessionId: result.session.id,
        registerName: result.session.registerName,
        attendanceShiftStarted: result.attendanceShiftStarted,
        recountDifference: result.recountDifference,
        matches: result.matches,
        reassignedSaleIds: result.reassignedSaleIds,
      };
    }),
});

export type ShiftHandoffsRouter = typeof shiftHandoffsRouter;
