/** Administrator-only payroll periods; closing requires a fully approved run set. */
import { and, eq, gt, lt, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { z } from 'zod';
import type { DatabaseInstance } from '../../db/index.js';
import { payrollPeriods, payrollRuns, tenants, type PayrollPeriod } from '../../db/schema.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { resolveColombiaPayrollPolicy } from '../../services/payroll/policy.js';
import { resolveTenantBusinessClock } from '../../services/pharmacy/business-clock.js';
import { addCalendarDays } from '../../services/reports/day-window.js';
import { closePayrollPeriodInput, createPayrollPeriodInput } from '../../trpc/schemas/payroll.js';
import type { WorkforceCommandContext } from '../workforce/writer.js';
import { withPayrollWriter } from '../workforce/writer.js';
import { denyPayroll } from './errors.js';

/** Minimal replay-safe period result; private reason remains outside the command journal. */
type PayrollPeriodResult = { id: string; status: 'open' | 'closed'; version: number };

function validateClock(countryCode: string): void {
  if (countryCode !== 'CO') denyPayroll('country');
}

function validatePolicyWindow(fromDate: string, untilDate: string): void {
  const first = resolveColombiaPayrollPolicy(fromDate);
  const last = resolveColombiaPayrollPolicy(addCalendarDays(untilDate, -1));
  if (!first || !last || first.policyVersion !== last.policyVersion) denyPayroll('policy');
}

function finishPeriod(
  ctx: WorkforceCommandContext,
  tx: DatabaseInstance,
  row: PayrollPeriod
): PayrollPeriodResult {
  const result = { id: row.id, status: row.status, version: row.version };
  ctx.completeInTransaction(tx, result);
  return result;
}

export async function createPayrollPeriod(
  ctx: WorkforceCommandContext,
  raw: z.input<typeof createPayrollPeriodInput>
): Promise<PayrollPeriodResult> {
  const input = createPayrollPeriodInput.parse(raw);
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  validateClock(clock.countryCode);
  validatePolicyWindow(input.fromDate, input.untilDate);
  return withPayrollWriter(
    ctx,
    tx => {
      const tenant = tx
        .select({ currencyCode: tenants.defaultCurrencyCode })
        .from(tenants)
        .where(and(eq(tenants.id, ctx.tenantId), eq(tenants.isActive, true)))
        .get();
      if (!tenant) denyPayroll('not_found');
      if (tenant.currencyCode !== input.currencyCode) denyPayroll('currency');
      const overlap = tx
        .select({ id: payrollPeriods.id })
        .from(payrollPeriods)
        .where(
          and(
            eq(payrollPeriods.tenantId, ctx.tenantId),
            lt(payrollPeriods.fromDate, input.untilDate),
            gt(payrollPeriods.untilDate, input.fromDate)
          )
        )
        .get();
      if (overlap) denyPayroll('period_overlap');
      const now = new Date().toISOString();
      const row = tx
        .insert(payrollPeriods)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          countryCode: input.countryCode,
          frequency: input.frequency,
          fromDate: input.fromDate,
          untilDate: input.untilDate,
          payDate: input.payDate,
          currencyCode: input.currencyCode,
          createdReason: input.reason,
          createdByUserId: ctx.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()!;
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        operationId: ctx.envelope.operationId,
        action: 'payroll_period.changed',
        resourceType: 'payroll_period',
        resourceId: row.id,
        before: null,
        after: { status: row.status, version: row.version },
      });
      return finishPeriod(ctx, tx, row);
    },
    clock
  );
}

export async function closePayrollPeriod(
  ctx: WorkforceCommandContext,
  raw: z.input<typeof closePayrollPeriodInput>
): Promise<PayrollPeriodResult> {
  const input = closePayrollPeriodInput.parse(raw);
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  validateClock(clock.countryCode);
  return withPayrollWriter(
    ctx,
    tx => {
      const before = tx
        .select()
        .from(payrollPeriods)
        .where(and(eq(payrollPeriods.tenantId, ctx.tenantId), eq(payrollPeriods.id, input.id)))
        .get();
      if (!before) denyPayroll('not_found');
      if (before.version !== input.expectedVersion) denyPayroll('version');
      if (before.status !== 'open') denyPayroll('state');
      const regularApproved = tx
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.tenantId, ctx.tenantId),
            eq(payrollRuns.periodId, before.id),
            eq(payrollRuns.kind, 'regular'),
            eq(payrollRuns.status, 'approved')
          )
        )
        .get();
      const unfinished = tx
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.tenantId, ctx.tenantId),
            eq(payrollRuns.periodId, before.id),
            ne(payrollRuns.status, 'approved')
          )
        )
        .get();
      if (!regularApproved || unfinished) denyPayroll('blocked');
      const row = tx
        .update(payrollPeriods)
        .set({
          status: 'closed',
          version: before.version + 1,
          closedByUserId: ctx.user.id,
          closedAt: clock.nowIso,
          closedReason: input.reason,
          updatedAt: clock.nowIso,
        })
        .where(
          and(
            eq(payrollPeriods.tenantId, ctx.tenantId),
            eq(payrollPeriods.id, before.id),
            eq(payrollPeriods.version, before.version),
            eq(payrollPeriods.status, 'open')
          )
        )
        .returning()
        .get();
      if (!row) denyPayroll('version');
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        operationId: ctx.envelope.operationId,
        action: 'payroll_period.changed',
        resourceType: 'payroll_period',
        resourceId: row.id,
        before: { status: before.status, version: before.version },
        after: { status: row.status, version: row.version },
      });
      return finishPeriod(ctx, tx, row);
    },
    clock
  );
}
