import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { employeeShifts, sites } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  employeeShiftSelection,
  getOpenCashSessionForEmployee,
  getOpenEmployeeBreak,
  getOpenEmployeeShift,
  throwAlreadyClockedIn,
  throwBreakActive,
  throwCashSessionOpen,
  throwNotClockedIn,
} from '../../services/labor/attendance-state.js';
import { router } from '../init.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { criticalCommandCashierManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import { cashierManagerOrAdminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  clockInEmployeeShiftInput,
  clockOutEmployeeShiftInput,
} from '../schemas/employeeShifts.js';
import { employeeAttendanceRouter } from './employeeAttendance.js';
import { employeeBreaksRouter } from './employeeBreaks.js';
import { employeeSchedulesRouter } from './employeeSchedules.js';

export const employeeShiftsRouter = router({
  schedule: employeeSchedulesRouter,
  breaks: employeeBreaksRouter,
  attendance: employeeAttendanceRouter,

  /** Self-scoped current attendance state; never exposes another employee. */
  current: cashierManagerOrAdminProcedure.query(async ({ ctx }) => {
    const current = getOpenEmployeeShift(ctx.db, ctx.tenantId, ctx.user!.id);
    if (!current) return null;
    return {
      ...current,
      activeCashSession: getOpenCashSessionForEmployee(ctx.db, ctx.tenantId, ctx.user!.id) ?? null,
    };
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

      const existing = getOpenEmployeeShift(criticalCtx.db, criticalCtx.tenantId, actorId);
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
            operationId: criticalCtx.envelope.operationId,
          });
        });
      } catch (error) {
        if (
          error instanceof Error &&
          /UNIQUE constraint failed: employee_shifts\.tenant_id, employee_shifts\.user_id/i.test(
            error.message
          )
        ) {
          const raced = getOpenEmployeeShift(criticalCtx.db, criticalCtx.tenantId, actorId);
          if (raced) throwAlreadyClockedIn(raced);
        }
        throw error;
      }

      const inserted = getOpenEmployeeShift(criticalCtx.db, criticalCtx.tenantId, actorId);
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
      const current = getOpenEmployeeShift(criticalCtx.db, criticalCtx.tenantId, actorId);
      if (!current) throwNotClockedIn();
      const activeCashSession = getOpenCashSessionForEmployee(
        criticalCtx.db,
        criticalCtx.tenantId,
        actorId
      );
      if (activeCashSession) throwCashSessionOpen(activeCashSession);

      let clockedOutAt: string | null;
      try {
        clockedOutAt = criticalCtx.db.transaction(
          tx => {
            const racedCashSession = getOpenCashSessionForEmployee(
              tx,
              criticalCtx.tenantId,
              actorId
            );
            if (racedCashSession) throwCashSessionOpen(racedCashSession);
            if (getOpenEmployeeBreak(tx, criticalCtx.tenantId, actorId)) throwBreakActive();
            const now = new Date().toISOString();
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
            if (result.changes !== 1) return null;

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
              operationId: criticalCtx.envelope.operationId,
            });
            return now;
          },
          { behavior: 'immediate' }
        );
      } catch (error) {
        if (error instanceof Error && /EMPLOYEE_SHIFT_CASH_SESSION_OPEN/i.test(error.message)) {
          const active = getOpenCashSessionForEmployee(
            criticalCtx.db,
            criticalCtx.tenantId,
            actorId
          );
          if (active) throwCashSessionOpen(active);
        }
        if (error instanceof Error && /EMPLOYEE_SHIFT_BREAK_ACTIVE/i.test(error.message)) {
          throwBreakActive();
        }
        throw error;
      }

      if (!clockedOutAt) throwNotClockedIn();

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
