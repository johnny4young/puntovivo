import { and, desc, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { employeeShifts, sites } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { router } from '../init.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { criticalCommandCashierManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import { cashierManagerOrAdminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  clockInEmployeeShiftInput,
  clockOutEmployeeShiftInput,
} from '../schemas/employeeShifts.js';
import { employeeSchedulesRouter } from './employeeSchedules.js';

const employeeShiftSelection = {
  id: employeeShifts.id,
  tenantId: employeeShifts.tenantId,
  userId: employeeShifts.userId,
  siteId: employeeShifts.siteId,
  siteName: sites.name,
  clockedInAt: employeeShifts.clockedInAt,
  clockedOutAt: employeeShifts.clockedOutAt,
  createdAt: employeeShifts.createdAt,
  updatedAt: employeeShifts.updatedAt,
} as const;

async function getOpenShift(db: DatabaseInstance, tenantId: string, userId: string) {
  return db
    .select(employeeShiftSelection)
    .from(employeeShifts)
    .innerJoin(
      sites,
      and(eq(employeeShifts.siteId, sites.id), eq(sites.tenantId, tenantId))
    )
    .where(
      and(
        eq(employeeShifts.tenantId, tenantId),
        eq(employeeShifts.userId, userId),
        isNull(employeeShifts.clockedOutAt)
      )
    )
    .orderBy(desc(employeeShifts.clockedInAt))
    .get();
}

function throwAlreadyClockedIn(
  shift: NonNullable<Awaited<ReturnType<typeof getOpenShift>>>
): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'EMPLOYEE_SHIFT_ALREADY_CLOCKED_IN',
    message: 'The employee already has an open shift.',
    details: {
      shiftId: shift.id,
      siteId: shift.siteId,
      clockedInAt: shift.clockedInAt,
    },
  });
}

function throwNotClockedIn(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'EMPLOYEE_SHIFT_NOT_CLOCKED_IN',
    message: 'The employee does not have an open shift.',
  });
}

export const employeeShiftsRouter = router({
  schedule: employeeSchedulesRouter,

  /** Self-scoped current attendance state; never exposes another employee. */
  current: cashierManagerOrAdminProcedure.query(async ({ ctx }) => {
    return (await getOpenShift(ctx.db, ctx.tenantId, ctx.user!.id)) ?? null;
  }),

  clockIn: criticalCommandCashierManagerOrAdminProcedure
    .input(clockInEmployeeShiftInput)
    .mutation(async ({ ctx, input }) => {
      const criticalCtx = asCriticalCommandContext(ctx);
      const actorId = criticalCtx.user.id;
      const site = await ensureTenantSite(criticalCtx.db, criticalCtx.tenantId, input.siteId);
      if (!site.isActive) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'EMPLOYEE_SHIFT_SITE_INACTIVE',
          message: 'Clock-in requires an active site.',
          details: { siteId: site.id },
        });
      }

      const existing = await getOpenShift(criticalCtx.db, criticalCtx.tenantId, actorId);
      if (existing) throwAlreadyClockedIn(existing);

      const shiftId = nanoid();
      const now = new Date().toISOString();
      try {
        criticalCtx.db.transaction(tx => {
          tx.insert(employeeShifts)
            .values({
              id: shiftId,
              tenantId: criticalCtx.tenantId,
              userId: actorId,
              siteId: site.id,
              clockedInAt: now,
              clockedOutAt: null,
              createdAt: now,
              updatedAt: now,
            })
            .run();

          writeAuditLog({
            tx,
            tenantId: criticalCtx.tenantId,
            actorId,
            action: 'employee_shift.clock_in',
            resourceType: 'employee_shift',
            resourceId: shiftId,
            before: null,
            after: {
              userId: actorId,
              siteId: site.id,
              clockedInAt: now,
              clockedOutAt: null,
            },
            metadata: { siteName: site.name },
          });
        });
      } catch (error) {
        if (
          error instanceof Error &&
          /UNIQUE constraint failed: employee_shifts\.tenant_id, employee_shifts\.user_id/i.test(
            error.message
          )
        ) {
          const raced = await getOpenShift(criticalCtx.db, criticalCtx.tenantId, actorId);
          if (raced) throwAlreadyClockedIn(raced);
        }
        throw error;
      }

      const inserted = await getOpenShift(criticalCtx.db, criticalCtx.tenantId, actorId);
      if (!inserted || inserted.id !== shiftId) {
        throwServerError({
          trpcCode: 'INTERNAL_SERVER_ERROR',
          errorCode: 'EMPLOYEE_SHIFT_PERSIST_FAILED',
          message: 'The clock-in record could not be reloaded.',
          details: { shiftId, operation: 'clock_in' },
        });
      }
      return inserted;
    }),

  clockOut: criticalCommandCashierManagerOrAdminProcedure
    .input(clockOutEmployeeShiftInput)
    .mutation(async ({ ctx }) => {
      const criticalCtx = asCriticalCommandContext(ctx);
      const actorId = criticalCtx.user.id;
      const current = await getOpenShift(criticalCtx.db, criticalCtx.tenantId, actorId);
      if (!current) throwNotClockedIn();

      const now = new Date().toISOString();
      const updated = criticalCtx.db.transaction(tx => {
        const result = tx
          .update(employeeShifts)
          .set({ clockedOutAt: now, updatedAt: now })
          .where(
            and(
              eq(employeeShifts.id, current.id),
              eq(employeeShifts.tenantId, criticalCtx.tenantId),
              eq(employeeShifts.userId, actorId),
              isNull(employeeShifts.clockedOutAt)
            )
          )
          .run();
        if (result.changes !== 1) return false;

        writeAuditLog({
          tx,
          tenantId: criticalCtx.tenantId,
          actorId,
          action: 'employee_shift.clock_out',
          resourceType: 'employee_shift',
          resourceId: current.id,
          before: {
            userId: actorId,
            siteId: current.siteId,
            clockedInAt: current.clockedInAt,
            clockedOutAt: null,
          },
          after: {
            userId: actorId,
            siteId: current.siteId,
            clockedInAt: current.clockedInAt,
            clockedOutAt: now,
          },
          metadata: { siteName: current.siteName },
        });
        return true;
      });

      if (!updated) throwNotClockedIn();

      const closed = await criticalCtx.db
        .select(employeeShiftSelection)
        .from(employeeShifts)
        .innerJoin(
          sites,
          and(eq(employeeShifts.siteId, sites.id), eq(sites.tenantId, criticalCtx.tenantId))
        )
        .where(
          and(
            eq(employeeShifts.id, current.id),
            eq(employeeShifts.tenantId, criticalCtx.tenantId),
            eq(employeeShifts.userId, actorId)
          )
        )
        .get();
      if (!closed?.clockedOutAt) {
        throwServerError({
          trpcCode: 'INTERNAL_SERVER_ERROR',
          errorCode: 'EMPLOYEE_SHIFT_PERSIST_FAILED',
          message: 'The clock-out record could not be reloaded.',
          details: { shiftId: current.id, operation: 'clock_out' },
        });
      }
      return closed;
    }),
});
