/** End-to-end private pre-payroll run qualification without HTTP or external providers. */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approvePayrollRun,
  createPayrollRun,
  recalculatePayrollRun,
  reviewPayrollRun,
} from '../application/payroll/runs.js';
import type { WorkforceCommandContext } from '../application/workforce/writer.js';
import { createPayrollPeriod } from '../application/payroll/periods.js';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import {
  auditLogs,
  payrollConceptLines,
  payrollEmployeeResults,
  payrollResultSources,
  payrollRunEvents,
  payrollRunRevisions,
  payrollRuns,
} from '../db/schema.js';
import type { PayrollEmployeeSettlementInput } from '../trpc/schemas/payroll.js';
import { getPayrollRunPreparation } from '../services/payroll/preparation.js';

function sqlite() {
  return (getDatabase() as unknown as { $client: Database.Database }).$client;
}

function context(overrides: Partial<WorkforceCommandContext> = {}): WorkforceCommandContext {
  return {
    db: getDatabase(),
    tenantId: 'tenant',
    user: { id: 'admin', role: 'admin', email: 'admin@example.test', tenantId: 'tenant' },
    deviceId: 'device-1',
    envelope: {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    },
    completeInTransaction: vi.fn(),
    ...overrides,
  };
}

function seedWorker(
  userId: string,
  basis: 'monthly' | 'hourly',
  amount: number,
  window: { from?: string; until?: string | null } = {}
): void {
  const effectiveFrom = window.from ?? '2026-01-01';
  const effectiveUntil = window.until ?? null;
  sqlite()
    .prepare(
      `INSERT INTO users(id,tenant_id,name,email,password_hash,role)
       VALUES (?,?,?,?,'unused','cashier')`
    )
    .run(userId, 'tenant', userId, `${userId}@example.test`);
  sqlite()
    .prepare(
      `INSERT INTO employment_contracts(
        id,tenant_id,user_id,site_id,position,effective_from,effective_until,time_zone,currency_code,
        pay_basis,pay_amount,version,created_by_user_id,updated_by_user_id
      ) VALUES (?, 'tenant', ?, 'site', 'Operator', ?, ?, 'America/Bogota',
        'COP', ?, ?, 1, 'admin', 'admin')`
    )
    .run(`contract-${userId}`, userId, effectiveFrom, effectiveUntil, basis, amount);
  sqlite()
    .prepare(
      `INSERT INTO payroll_employee_profiles(
        id,tenant_id,user_id,site_id,country_code,identification_type,
        identification_number,contributor_type,contract_kind,integral_salary,
        arl_risk_class,transport_assistance_eligible,payment_method,
        effective_from,effective_until,created_by_user_id,updated_by_user_id
      ) VALUES (?, 'tenant', ?, 'site', 'CO', 'CC', ?, '01', 'indefinite', 0,
        1, 0, 'cash', ?, ?, 'admin', 'admin')`
    )
    .run(`profile-${userId}`, userId, `1000${userId}`, effectiveFrom, effectiveUntil);
}

function settlement(
  userId: string,
  overrides: Partial<PayrollEmployeeSettlementInput> = {}
): PayrollEmployeeSettlementInput {
  return {
    userId,
    payrollDays: 30,
    ordinaryWorkedSeconds: null,
    employeeClassification: 'private_cst',
    holidayCalendarReviewed: true,
    employeeRestDayReviewed: true,
    contributionExemption: 'does_not_apply',
    contributionBaseAmount: 2_000_000,
    transportAssistance: 'does_not_apply',
    withholding: {
      status: 'complete',
      amount: 0,
      reason: 'Reviewed withholding for this payroll period',
    },
    benefitsReviewed: true,
    reviewReason: 'Reviewed against private employee payroll evidence',
    manualConcepts: [],
    ...overrides,
  };
}

async function period(fromDate = '2026-08-01', untilDate = '2026-09-01', payDate = '2026-09-05') {
  return createPayrollPeriod(context(), {
    countryCode: 'CO',
    frequency: 'monthly',
    fromDate,
    untilDate,
    payDate,
    currencyCode: 'COP',
    reason: `Reviewed payroll period ${fromDate}`,
  });
}

async function regularRun(periodId: string) {
  return createPayrollRun(context(), {
    periodId,
    kind: 'regular',
    originalRunId: null,
    reason: 'Created regular payroll run for review',
  });
}

async function authorityToken(runId: string): Promise<string> {
  return (await getPayrollRunPreparation(getDatabase(), 'tenant', runId)).authorityToken;
}

async function approveRun(
  run: Awaited<ReturnType<typeof createPayrollRun>>,
  employees: PayrollEmployeeSettlementInput[]
) {
  const calculated = await recalculatePayrollRun(context(), {
    runId: run.id,
    expectedVersion: run.version,
    authorityToken: await authorityToken(run.id),
    policyAcknowledged: true,
    employees,
    reason: 'Calculated reviewed payroll employee evidence',
  });
  const reviewed = await reviewPayrollRun(context(), {
    runId: run.id,
    expectedVersion: calculated.version,
    expectedRevision: calculated.currentRevision,
    reason: 'Reviewed exact complete payroll revision',
  });
  return approvePayrollRun(context(), {
    runId: run.id,
    expectedVersion: reviewed.version,
    expectedRevision: reviewed.currentRevision,
    reason: 'Approved exact reviewed payroll revision',
  });
}

beforeEach(async () => {
  await initDatabase({ dbPath: ':memory:', seedData: false });
  sqlite().exec(`
    INSERT INTO tenants(id,name,slug,default_currency_code) VALUES
      ('tenant','Tenant','tenant-runs','COP'),('foreign','Foreign','foreign-runs','COP');
    INSERT INTO companies(id,tenant_id,name) VALUES
      ('company','tenant','Company'),('foreign-company','foreign','Foreign');
    INSERT INTO sites(id,tenant_id,company_id,name) VALUES
      ('site','tenant','company','Central'),('foreign-site','foreign','foreign-company','Foreign');
    INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES
      ('admin','tenant','Admin','admin@example.test','unused','admin'),
      ('manager','tenant','Manager','manager@example.test','unused','manager'),
      ('foreign-admin','foreign','Foreign','foreign@example.test','unused','admin');
    INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES
      ('tenant','CO'),('foreign','CO');
  `);
});

afterEach(() => closeDatabase());

describe('payroll run application service', () => {
  it('freezes sources, persists exact-rate concepts, and advances draft to approved', async () => {
    seedWorker('monthly-a', 'monthly', 2_000_000);
    const payrollPeriod = await period();
    const created = await regularRun(payrollPeriod.id);
    const calculated = await recalculatePayrollRun(context(), {
      runId: created.id,
      expectedVersion: created.version,
      authorityToken: await authorityToken(created.id),
      policyAcknowledged: true,
      employees: [settlement('monthly-a')],
      reason: 'Calculated reviewed payroll employee evidence',
    });
    expect(calculated).toMatchObject({ status: 'draft', currentRevision: 1, version: 2 });
    expect(getDatabase().select().from(payrollRunRevisions).get()).toMatchObject({
      status: 'complete',
      grossAmount: 2_000_000,
      deductionAmount: 160_000,
      netAmount: 1_840_000,
      employerContributionAmount: 600_440,
      blockers: [],
    });
    const employeeResult = getDatabase().select().from(payrollEmployeeResults).get()!;
    expect(employeeResult.sourceSnapshot).toMatchObject({
      employmentContractId: 'contract-monthly-a',
      settlementReview: {
        operationId: expect.any(String),
        payrollDays: 30,
        reviewReason: 'Reviewed against private employee payroll evidence',
      },
      adjustmentSource: null,
    });
    expect(
      getDatabase()
        .select()
        .from(payrollResultSources)
        .all()
        .map(row => row.kind)
        .sort()
    ).toEqual(['employment_contract', 'payroll_profile', 'policy']);
    expect(
      getDatabase()
        .select()
        .from(payrollConceptLines)
        .all()
        .find(line => line.code === 'arl')
    ).toMatchObject({ rate: 0.00522, amount: 10_440 });
    const reviewed = await reviewPayrollRun(context(), {
      runId: created.id,
      expectedVersion: calculated.version,
      expectedRevision: 1,
      reason: 'Reviewed exact complete payroll revision',
    });
    const approved = await approvePayrollRun(context(), {
      runId: created.id,
      expectedVersion: reviewed.version,
      expectedRevision: 1,
      reason: 'Approved exact reviewed payroll revision',
    });
    expect(approved).toMatchObject({ status: 'approved', approvedRevision: 1, version: 4 });
    expect(
      getDatabase()
        .select()
        .from(payrollRunEvents)
        .all()
        .map(row => row.kind)
    ).toEqual(['created', 'recalculated', 'reviewed', 'approved']);
    const publicEvidence = JSON.stringify({
      approved,
      audit: getDatabase().select().from(auditLogs).all(),
    });
    expect(publicEvidence).not.toContain('1000monthly-a');
    expect(publicEvidence).not.toContain('Reviewed exact complete payroll revision');
  });

  it('blocks the entire revision when one employee is incomplete, then appends a corrected revision', async () => {
    seedWorker('monthly-a', 'monthly', 2_000_000);
    seedWorker('monthly-b', 'monthly', 2_000_000);
    const payrollPeriod = await period();
    const run = await regularRun(payrollPeriod.id);
    const blocked = await recalculatePayrollRun(context(), {
      runId: run.id,
      expectedVersion: run.version,
      authorityToken: await authorityToken(run.id),
      policyAcknowledged: true,
      employees: [
        settlement('monthly-a'),
        settlement('monthly-b', { transportAssistance: 'review_required' }),
      ],
      reason: 'Attempt calculation with incomplete employee review',
    });
    expect(blocked).toMatchObject({ currentRevision: 1, version: 2 });
    expect(getDatabase().select().from(payrollRunRevisions).get()).toMatchObject({
      status: 'blocked',
      grossAmount: 0,
      netAmount: 0,
    });
    const blockedResults = getDatabase().select().from(payrollEmployeeResults).all();
    expect(blockedResults).toHaveLength(2);
    expect(blockedResults.every(row => row.status === 'blocked' && row.grossAmount === 0)).toBe(
      true
    );
    expect(blockedResults.flatMap(row => row.blockers)).toEqual(
      expect.arrayContaining([
        'run_contains_blocked_employee',
        'transport_assistance_review_required',
      ])
    );
    expect(getDatabase().select().from(payrollConceptLines).all()).toEqual([]);
    await expect(
      reviewPayrollRun(context(), {
        runId: run.id,
        expectedVersion: blocked.version,
        expectedRevision: 1,
        reason: 'Cannot review a blocked payroll revision',
      })
    ).rejects.toMatchObject({ reason: 'blocked' });
    const corrected = await recalculatePayrollRun(context(), {
      runId: run.id,
      expectedVersion: blocked.version,
      authorityToken: await authorityToken(run.id),
      policyAcknowledged: true,
      employees: [settlement('monthly-a'), settlement('monthly-b')],
      reason: 'Recalculated after completing every employee review',
    });
    expect(corrected).toMatchObject({ currentRevision: 2, version: 3 });
    expect(
      getDatabase()
        .select()
        .from(payrollRunRevisions)
        .all()
        .map(row => row.status)
    ).toEqual(['blocked', 'complete']);
    expect(getDatabase().select().from(payrollConceptLines).all().length).toBeGreaterThan(0);
  });

  it('rejects silent employee omission and does not depend on current active flags', async () => {
    seedWorker('monthly-a', 'monthly', 2_000_000);
    seedWorker('monthly-b', 'monthly', 2_000_000);
    const payrollPeriod = await period();
    const run = await regularRun(payrollPeriod.id);
    await expect(
      recalculatePayrollRun(context(), {
        runId: run.id,
        expectedVersion: run.version,
        authorityToken: await authorityToken(run.id),
        policyAcknowledged: true,
        employees: [settlement('monthly-a')],
        reason: 'Attempt to omit one authoritative payroll employee',
      })
    ).rejects.toMatchObject({ reason: 'employee_set' });
    expect(getDatabase().select().from(payrollRunRevisions).all()).toEqual([]);
    sqlite().exec(`
      UPDATE users SET is_active = 0 WHERE id = 'monthly-b';
      UPDATE sites SET is_active = 0 WHERE id = 'site';
    `);
    const calculated = await recalculatePayrollRun(context(), {
      runId: run.id,
      expectedVersion: run.version,
      authorityToken: await authorityToken(run.id),
      policyAcknowledged: true,
      employees: [settlement('monthly-a'), settlement('monthly-b')],
      reason: 'Calculate every employee from effective historical evidence',
    });
    expect(calculated).toMatchObject({ currentRevision: 1, version: 2 });
  });

  it('includes a single partial-period employment window instead of omitting the employee', async () => {
    seedWorker('mid-period', 'monthly', 2_000_000, {
      from: '2026-08-15',
      until: '2026-08-25',
    });
    const payrollPeriod = await period();
    const run = await regularRun(payrollPeriod.id);
    const preparation = await getPayrollRunPreparation(getDatabase(), 'tenant', run.id);
    expect(preparation).toMatchObject({
      ready: true,
      employees: [
        expect.objectContaining({
          userId: 'mid-period',
          payBasis: 'monthly',
          configurationBlockers: [],
        }),
      ],
    });
    const calculated = await recalculatePayrollRun(context(), {
      runId: run.id,
      expectedVersion: run.version,
      authorityToken: preparation.authorityToken,
      policyAcknowledged: true,
      employees: [settlement('mid-period', { payrollDays: 10 })],
      reason: 'Calculate the reviewed partial employment window',
    });
    expect(calculated).toMatchObject({ currentRevision: 1, version: 2 });
    expect(getDatabase().select().from(payrollRunRevisions).get()).toMatchObject({
      status: 'complete',
    });
  });

  it('rejects a stale preparation token before writing a revision', async () => {
    seedWorker('monthly-a', 'monthly', 2_000_000);
    const payrollPeriod = await period();
    const run = await regularRun(payrollPeriod.id);
    const staleToken = await authorityToken(run.id);
    sqlite()
      .prepare(
        `UPDATE employment_contracts
         SET pay_amount = 2100000, version = 2, updated_at = '2026-08-20T00:00:00.000Z'
         WHERE id = 'contract-monthly-a'`
      )
      .run();
    expect(await authorityToken(run.id)).not.toBe(staleToken);
    await expect(
      recalculatePayrollRun(context(), {
        runId: run.id,
        expectedVersion: run.version,
        authorityToken: staleToken,
        policyAcknowledged: true,
        employees: [settlement('monthly-a')],
        reason: 'Reject calculation against superseded payroll evidence',
      })
    ).rejects.toMatchObject({ reason: 'authority_changed' });
    expect(getDatabase().select().from(payrollRunRevisions).all()).toEqual([]);
  });

  it('derives hourly evidence through the latest correction and rejects mismatched seconds', async () => {
    seedWorker('hourly-a', 'hourly', 10_000);
    sqlite().exec(`
      INSERT INTO employee_shifts(
        id,tenant_id,user_id,site_id,clocked_in_at,clocked_out_at
      ) VALUES (
        'shift-hourly','tenant','hourly-a','site',
        '2026-08-03T13:00:00.000Z','2026-08-03T22:00:00.000Z'
      );
      INSERT INTO employee_shift_breaks(
        id,tenant_id,employee_shift_id,user_id,started_at,ended_at,
        started_by_user_id,ended_by_user_id
      ) VALUES (
        'break-hourly','tenant','shift-hourly','hourly-a',
        '2026-08-03T17:00:00.000Z','2026-08-03T18:00:00.000Z','hourly-a','hourly-a'
      );
    `);
    const payrollPeriod = await period();
    const run = await regularRun(payrollPeriod.id);
    const wrong = await recalculatePayrollRun(context(), {
      runId: run.id,
      expectedVersion: run.version,
      authorityToken: await authorityToken(run.id),
      policyAcknowledged: true,
      employees: [
        settlement('hourly-a', {
          payrollDays: null,
          ordinaryWorkedSeconds: 7 * 3_600,
          contributionBaseAmount: 70_000,
        }),
      ],
      reason: 'Attempt with attendance seconds that do not reconcile',
    });
    expect(getDatabase().select().from(payrollEmployeeResults).get()).toMatchObject({
      status: 'blocked',
      blockers: ['attendance_seconds_mismatch'],
    });
    sqlite().exec(`
      INSERT INTO employee_shift_corrections(
        id,tenant_id,employee_shift_id,version,clocked_in_at,clocked_out_at,breaks_json,
        reason,created_by_user_id
      ) VALUES (
        'correction-hourly','tenant','shift-hourly',1,
        '2026-08-03T13:00:00.000Z','2026-08-03T21:00:00.000Z',
        '[{"id":"corrected-break","startedAt":"2026-08-03T17:00:00.000Z","endedAt":"2026-08-03T18:00:00.000Z"}]',
        'Manager corrected the clock-out evidence','admin'
      );
    `);
    const corrected = await recalculatePayrollRun(context(), {
      runId: run.id,
      expectedVersion: wrong.version,
      authorityToken: await authorityToken(run.id),
      policyAcknowledged: true,
      employees: [
        settlement('hourly-a', {
          payrollDays: null,
          ordinaryWorkedSeconds: 7 * 3_600,
          contributionBaseAmount: 70_000,
        }),
      ],
      reason: 'Recalculate with corrected exact attendance evidence',
    });
    expect(corrected).toMatchObject({ currentRevision: 2, version: 3 });
    const revisions = getDatabase().select().from(payrollRunRevisions).all();
    expect(revisions.map(row => row.status)).toEqual(['blocked', 'complete']);
    expect(revisions[1]).toMatchObject({ grossAmount: 70_000, netAmount: 64_400 });
    expect(
      getDatabase()
        .select()
        .from(payrollResultSources)
        .all()
        .map(row => row.kind)
    ).toContain('attendance_correction');
  });

  it('fails closed when effective attendance intervals overlap', async () => {
    seedWorker('hourly-a', 'hourly', 10_000);
    sqlite().exec(`
      INSERT INTO employee_shifts(
        id,tenant_id,user_id,site_id,clocked_in_at,clocked_out_at
      ) VALUES
        ('shift-overlap-a','tenant','hourly-a','site',
          '2026-08-03T13:00:00.000Z','2026-08-03T17:00:00.000Z'),
        ('shift-overlap-b','tenant','hourly-a','site',
          '2026-08-03T16:00:00.000Z','2026-08-03T20:00:00.000Z');
    `);
    const payrollPeriod = await period();
    const run = await regularRun(payrollPeriod.id);
    const preparation = await getPayrollRunPreparation(getDatabase(), 'tenant', run.id);
    expect(preparation.employees[0]).toMatchObject({
      userId: 'hourly-a',
      derivedWorkedSeconds: 8 * 3_600,
      attendanceBlockers: ['attendance_evidence_overlaps'],
    });
    await recalculatePayrollRun(context(), {
      runId: run.id,
      expectedVersion: run.version,
      authorityToken: preparation.authorityToken,
      policyAcknowledged: true,
      employees: [
        settlement('hourly-a', {
          payrollDays: null,
          ordinaryWorkedSeconds: 8 * 3_600,
          contributionBaseAmount: 80_000,
        }),
      ],
      reason: 'Retain blocked evidence for overlapping attendance',
    });
    expect(getDatabase().select().from(payrollRunRevisions).get()).toMatchObject({
      status: 'blocked',
      blockers: ['attendance_evidence_overlaps'],
    });
  });

  it('prepares multiple hourly employees from the same bounded attendance snapshot', async () => {
    seedWorker('hourly-a', 'hourly', 10_000);
    seedWorker('hourly-b', 'hourly', 12_000);
    sqlite().exec(`
      INSERT INTO employee_shifts(
        id,tenant_id,user_id,site_id,clocked_in_at,clocked_out_at
      ) VALUES
        ('shift-batch-a','tenant','hourly-a','site',
          '2026-08-04T13:00:00.000Z','2026-08-04T17:00:00.000Z'),
        ('shift-batch-b','tenant','hourly-b','site',
          '2026-08-04T14:00:00.000Z','2026-08-04T20:00:00.000Z');
    `);
    const payrollPeriod = await period();
    const run = await regularRun(payrollPeriod.id);
    const preparation = await getPayrollRunPreparation(getDatabase(), 'tenant', run.id);
    expect(
      Object.fromEntries(
        preparation.employees.map(employee => [employee.userId, employee.derivedWorkedSeconds])
      )
    ).toEqual({ 'hourly-a': 4 * 3_600, 'hourly-b': 6 * 3_600 });
    const calculated = await recalculatePayrollRun(context(), {
      runId: run.id,
      expectedVersion: run.version,
      authorityToken: preparation.authorityToken,
      policyAcknowledged: true,
      employees: [
        settlement('hourly-a', {
          payrollDays: null,
          ordinaryWorkedSeconds: 4 * 3_600,
          contributionBaseAmount: 40_000,
        }),
        settlement('hourly-b', {
          payrollDays: null,
          ordinaryWorkedSeconds: 6 * 3_600,
          contributionBaseAmount: 72_000,
        }),
      ],
      reason: 'Calculate multiple employees from one attendance snapshot',
    });
    expect(calculated).toMatchObject({ currentRevision: 1, version: 2 });
    expect(getDatabase().select().from(payrollEmployeeResults).all()).toHaveLength(2);
  });

  it('rolls back every revision row when transactional command completion fails', async () => {
    seedWorker('monthly-a', 'monthly', 2_000_000);
    const payrollPeriod = await period();
    const run = await regularRun(payrollPeriod.id);
    const before = {
      run: getDatabase().select().from(payrollRuns).get(),
      revisions: getDatabase().select().from(payrollRunRevisions).all(),
      results: getDatabase().select().from(payrollEmployeeResults).all(),
      sources: getDatabase().select().from(payrollResultSources).all(),
      concepts: getDatabase().select().from(payrollConceptLines).all(),
      events: getDatabase().select().from(payrollRunEvents).all(),
      audit: getDatabase().select().from(auditLogs).all(),
    };
    await expect(
      recalculatePayrollRun(
        context({
          completeInTransaction: vi.fn(() => {
            throw new Error('Injected completion fault');
          }),
        }),
        {
          runId: run.id,
          expectedVersion: run.version,
          authorityToken: await authorityToken(run.id),
          policyAcknowledged: true,
          employees: [settlement('monthly-a')],
          reason: 'Calculation that must roll back atomically',
        }
      )
    ).rejects.toThrow('Injected completion fault');
    expect({
      run: getDatabase().select().from(payrollRuns).get(),
      revisions: getDatabase().select().from(payrollRunRevisions).all(),
      results: getDatabase().select().from(payrollEmployeeResults).all(),
      sources: getDatabase().select().from(payrollResultSources).all(),
      concepts: getDatabase().select().from(payrollConceptLines).all(),
      events: getDatabase().select().from(payrollRunEvents).all(),
      audit: getDatabase().select().from(auditLogs).all(),
    }).toEqual(before);
  });

  it('keeps adjustments append-only and prevents a second automatic salary', async () => {
    seedWorker('monthly-a', 'monthly', 2_000_000);
    const originalPeriod = await period();
    const original = await regularRun(originalPeriod.id);
    const approvedOriginal = await approveRun(original, [settlement('monthly-a')]);
    const adjustmentPeriod = await period('2026-09-01', '2026-10-01', '2026-10-05');
    const adjustment = await createPayrollRun(context(), {
      periodId: adjustmentPeriod.id,
      kind: 'adjustment',
      originalRunId: approvedOriginal.id,
      reason: 'Created an adjustment against the approved source run',
    });
    sqlite().exec(`
      UPDATE users SET is_active = 0 WHERE id = 'monthly-a';
      UPDATE employment_contracts
      SET pay_basis = 'hourly', pay_amount = 999999, version = 2,
          updated_at = '2026-09-02T00:00:00.000Z'
      WHERE id = 'contract-monthly-a';
    `);
    const preparation = await getPayrollRunPreparation(getDatabase(), 'tenant', adjustment.id);
    expect(preparation).toMatchObject({
      kind: 'adjustment',
      ready: true,
      employees: [
        expect.objectContaining({ userId: 'monthly-a', userActive: false, payBasis: 'monthly' }),
      ],
    });
    const unsafe = await recalculatePayrollRun(context(), {
      runId: adjustment.id,
      expectedVersion: adjustment.version,
      authorityToken: await authorityToken(adjustment.id),
      policyAcknowledged: true,
      employees: [settlement('monthly-a')],
      reason: 'Attempt an unsafe full salary adjustment',
    });
    expect(getDatabase().select().from(payrollRunRevisions).all().at(-1)).toMatchObject({
      status: 'blocked',
      blockers: expect.arrayContaining([
        'adjustment_manual_concept_required',
        'adjustment_requires_zero_automatic_base',
      ]),
    });
    const safe = await recalculatePayrollRun(context(), {
      runId: adjustment.id,
      expectedVersion: unsafe.version,
      authorityToken: await authorityToken(adjustment.id),
      policyAcknowledged: true,
      employees: [
        settlement('monthly-a', {
          payrollDays: 0,
          contributionBaseAmount: 0,
          manualConcepts: [
            {
              category: 'earning',
              code: 'approved_bonus_correction',
              label: 'Approved bonus correction',
              amount: 100_000,
              reason: 'Correct omitted approved variable compensation',
            },
          ],
        }),
      ],
      reason: 'Calculate manual-only approved adjustment evidence',
    });
    expect(safe).toMatchObject({ currentRevision: 2, version: 3 });
    const latestRevision = getDatabase().select().from(payrollRunRevisions).all().at(-1)!;
    expect(latestRevision).toMatchObject({
      status: 'complete',
      grossAmount: 100_000,
      netAmount: 100_000,
    });
    const latestResult = getDatabase()
      .select()
      .from(payrollEmployeeResults)
      .all()
      .find(row => row.revisionId === latestRevision.id)!;
    expect(latestResult.sourceSnapshot.adjustmentSource).toEqual({
      runId: approvedOriginal.id,
      revision: 1,
      employeeResultId: expect.any(String),
    });
    expect(
      getDatabase()
        .select()
        .from(payrollConceptLines)
        .all()
        .filter(row => row.employeeResultId === latestResult.id)
        .map(row => row.code)
    ).toEqual(['approved_bonus_correction']);
    const reviewed = await reviewPayrollRun(context(), {
      runId: adjustment.id,
      expectedVersion: safe.version,
      expectedRevision: 2,
      reason: 'Reviewed exact adjustment revision',
    });
    await expect(
      approvePayrollRun(context(), {
        runId: adjustment.id,
        expectedVersion: reviewed.version - 1,
        expectedRevision: 2,
        reason: 'Reject stale adjustment approval attempt',
      })
    ).rejects.toMatchObject({ reason: 'version' });
  });

  it('rejects duplicate regular runs, foreign rows, and non-administrator actors', async () => {
    const payrollPeriod = await period();
    const run = await regularRun(payrollPeriod.id);
    await expect(regularRun(payrollPeriod.id)).rejects.toMatchObject({
      reason: 'regular_run_exists',
    });
    await expect(
      recalculatePayrollRun(
        context({
          tenantId: 'foreign',
          user: {
            id: 'foreign-admin',
            role: 'admin',
            email: 'foreign@example.test',
            tenantId: 'foreign',
          },
        }),
        {
          runId: run.id,
          expectedVersion: run.version,
          authorityToken: await authorityToken(run.id),
          policyAcknowledged: true,
          employees: [settlement('monthly-a')],
          reason: 'Attempt to calculate a foreign payroll run',
        }
      )
    ).rejects.toMatchObject({ reason: 'not_found' });
    await expect(
      createPayrollRun(context({ user: { ...context().user, id: 'manager', role: 'manager' } }), {
        periodId: payrollPeriod.id,
        kind: 'adjustment',
        originalRunId: run.id,
        reason: 'Manager must not mutate private payroll',
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'AUTH_IDENTITY_CHANGED' } });
  });
});
