import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import {
  assertAttendanceReconciliationJourneyDiagnostics,
  runAttendanceReconciliationJourney,
} from '../shared/attendance-reconciliation-journey';
import { attachClientIssueTracker, E2E_PASSWORD, login } from './support/app';
import { seedSurfaceGateScenario } from './support/db';

test('reconciles signed attendance and no-shows without leaking private labor evidence', async ({
  page,
}, info) => {
  const scenario = seedSurfaceGateScenario(
    `attendance-reconciliation-${info.parallelIndex}-${Date.now()}`,
    {}
  );
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  const result = await runAttendanceReconciliationJourney(page, {
    navigate: route => page.goto(route),
    signIn: email => login(page, { email, password: E2E_PASSWORD, defaultPath: '/sales' }),
    signInAdmin: () => login(page, { ...scenario.admin, defaultPath: '/company' }),
    signInManager: email =>
      login(page, { email, password: E2E_PASSWORD, defaultPath: '/dashboard' }),
    screenshot: name => page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true }),
  });

  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'), {
    readonly: true,
  });
  try {
    const reconciliations = db
      .prepare(
        `SELECT r.id,r.scheduled_shift_id AS scheduledShiftId,
                r.employee_shift_id AS employeeShiftId,r.outcome,r.version
           FROM employee_shift_reconciliations r
          WHERE r.tenant_id=? AND r.scheduled_shift_id IN (?,?)
          ORDER BY r.outcome`
      )
      .all(scenario.tenantId, result.attendedScheduleId, result.noShowScheduleId) as Array<{
      id: string;
      scheduledShiftId: string;
      employeeShiftId: string | null;
      outcome: string;
      version: number;
    }>;
    expect(reconciliations).toHaveLength(2);
    const attended = reconciliations.find(row => row.outcome === 'attended');
    const noShow = reconciliations.find(row => row.outcome === 'no_show');
    expect(attended).toMatchObject({
      scheduledShiftId: result.attendedScheduleId,
      outcome: 'attended',
      version: 1,
    });
    expect(attended?.employeeShiftId).toBeTruthy();
    expect(noShow).toEqual({
      id: expect.any(String),
      scheduledShiftId: result.noShowScheduleId,
      employeeShiftId: null,
      outcome: 'no_show',
      version: 1,
    });

    const events = db
      .prepare(
        `SELECT e.reconciliation_id AS reconciliationId,e.version,e.kind,e.reason,
                actor.email AS actorEmail
           FROM employee_shift_reconciliation_events e
           JOIN users actor ON actor.id=e.actor_id AND actor.tenant_id=e.tenant_id
          WHERE e.tenant_id=? AND e.reconciliation_id IN (?,?)
          ORDER BY e.reason`
      )
      .all(scenario.tenantId, attended!.id, noShow!.id);
    expect(events).toEqual([
      {
        reconciliationId: noShow!.id,
        version: 1,
        kind: 'created',
        reason: result.noShowReason,
        actorEmail: scenario.admin.email,
      },
      {
        reconciliationId: attended!.id,
        version: 1,
        kind: 'created',
        reason: result.attendedReason,
        actorEmail: scenario.admin.email,
      },
    ]);

    const rawClock = db
      .prepare(
        `SELECT s.id,s.clocked_in_at AS clockedInAt,s.clocked_out_at AS clockedOutAt
           FROM employee_shifts s
           JOIN users employee ON employee.id=s.user_id AND employee.tenant_id=s.tenant_id
          WHERE s.tenant_id=? AND employee.email=?`
      )
      .get(scenario.tenantId, result.attended.email) as
      { id: string; clockedInAt: string; clockedOutAt: string | null } | undefined;
    expect(rawClock).toMatchObject({ id: attended!.employeeShiftId });
    expect(rawClock?.clockedOutAt).toBeTruthy();

    expect(
      db
        .prepare(
          `SELECT c.pay_basis AS payBasis,c.pay_amount AS payAmount,c.currency_code AS currencyCode
             FROM employment_contracts c
             JOIN users employee ON employee.id=c.user_id AND employee.tenant_id=c.tenant_id
            WHERE c.tenant_id=? AND employee.email=? AND c.voided_at IS NULL`
        )
        .all(scenario.tenantId, result.attended.email)
    ).toEqual([{ payBasis: 'hourly', payAmount: 360_000, currencyCode: 'COP' }]);

    const auditRows = db
      .prepare(
        `SELECT action,resource_type AS resourceType,"before","after"
           FROM audit_logs
          WHERE tenant_id=? AND resource_type='attendance_reconciliation'
          ORDER BY created_at,id`
      )
      .all(scenario.tenantId) as Array<Record<string, unknown>>;
    expect(auditRows).toHaveLength(2);
    expect(
      auditRows.every(
        row =>
          row.action === 'attendance_reconciliation.changed' &&
          row.resourceType === 'attendance_reconciliation'
      )
    ).toBe(true);

    const outbox = db
      .prepare(
        `SELECT status,payload
           FROM sync_outbox
          WHERE tenant_id=? AND entity_type='employee_shift_reconciliations'
          ORDER BY created_at,id`
      )
      .all(scenario.tenantId) as Array<{ status: string; payload: string }>;
    expect(outbox).toHaveLength(2);
    expect(outbox.every(row => row.status === 'local_only')).toBe(true);

    const genericEvidence = JSON.stringify({ auditRows, outbox });
    expect(genericEvidence).not.toContain(result.attendedReason);
    expect(genericEvidence).not.toContain(result.noShowReason);
    expect(genericEvidence).not.toContain('clockedInAt');
    expect(genericEvidence).not.toContain('clocked_in_at');
    expect(genericEvidence).not.toContain('payAmount');
    expect(genericEvidence).not.toContain('pay_amount');
  } finally {
    db.close();
  }
  assertAttendanceReconciliationJourneyDiagnostics(tracker);
});
