import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import { assertPayrollJourneyDiagnostics, runPayrollJourney } from '../shared/payroll-journey';
import { attachClientIssueTracker, login } from './support/app';
import { seedSurfaceGateScenario } from './support/db';

test('creates and reloads an immutable Colombia pre-payroll revision without leaking private evidence', async ({
  page,
}, info) => {
  const scenario = seedSurfaceGateScenario(`payroll-${info.parallelIndex}-${Date.now()}`, {});
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  const result = await runPayrollJourney(page, {
    navigate: route => page.goto(route),
    screenshot: name => page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true }),
  });

  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'), {
    readonly: true,
  });
  try {
    const run = db
      .prepare(
        `SELECT r.id,r.status,r.current_revision AS currentRevision,r.version
           FROM payroll_runs r
           JOIN payroll_periods p ON p.id=r.period_id AND p.tenant_id=r.tenant_id
          WHERE r.tenant_id=? AND p.from_date='2026-10-01' AND p.until_date='2026-11-01'`
      )
      .get(scenario.tenantId) as
      { id: string; status: string; currentRevision: number; version: number } | undefined;
    expect(run).toEqual({
      id: expect.any(String),
      status: 'draft',
      currentRevision: 1,
      version: 2,
    });

    const resultRow = db
      .prepare(
        `SELECT e.status,e.gross_amount AS grossAmount,
                e.deduction_amount AS employeeDeductionAmount,
                e.net_amount AS netAmount,e.employer_contribution_amount AS employerContributionAmount
           FROM payroll_employee_results e
           JOIN payroll_run_revisions rev ON rev.id=e.revision_id AND rev.tenant_id=e.tenant_id
           JOIN users employee ON employee.id=e.user_id AND employee.tenant_id=e.tenant_id
          WHERE e.tenant_id=? AND rev.run_id=? AND rev.revision=1 AND employee.email=?`
      )
      .get(scenario.tenantId, run!.id, result.worker.email);
    expect(resultRow).toEqual({
      status: 'complete',
      grossAmount: 3_500_000,
      employeeDeductionAmount: 280_000,
      netAmount: 3_220_000,
      employerContributionAmount: 1_050_770,
    });

    const auditRows = db
      .prepare(
        `SELECT action,resource_type AS resourceType,"before","after",metadata
           FROM audit_logs
          WHERE tenant_id=? AND resource_type IN ('payroll_profile','payroll_period','payroll_run')
          ORDER BY created_at,id`
      )
      .all(scenario.tenantId) as Array<Record<string, unknown>>;
    expect(auditRows.length).toBeGreaterThanOrEqual(4);
    const genericEvidence = JSON.stringify(auditRows);
    for (const privateValue of [
      result.employmentReason,
      result.profileReason,
      result.periodReason,
      result.runReason,
      result.employeeReason,
      result.calculationReason,
      `9${result.worker.email.match(/([a-f0-9]{10})@/)?.[1] ?? ''}`,
    ]) {
      expect(genericEvidence).not.toContain(privateValue);
    }

    const payrollSyncRows = db
      .prepare(
        `SELECT status,entity_type AS entityType,payload
           FROM sync_outbox
          WHERE tenant_id=? AND entity_type LIKE 'payroll%'
          ORDER BY created_at,id`
      )
      .all(scenario.tenantId) as Array<{ status: string; entityType: string; payload: string }>;
    expect(payrollSyncRows).toEqual([]);
  } finally {
    db.close();
  }
  assertPayrollJourneyDiagnostics(tracker);
});
