/** Explicit plan outcomes, correction-aware reads and immutable SQLite evidence. */
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDatabase } from '../db/index.js';
import { createServer, type PuntovivoServer } from '../index.js';
import { appRouter } from '../trpc/router.js';
import {
  createCriticalCommandFixture,
  freshCriticalContext,
} from './utils/criticalCommandFixture.js';
import { isRemoteSyncApplyBlocked, resolveSyncTransportPolicy } from '../services/sync/contract.js';

let server: PuntovivoServer;
const devices = new Map<string, string>();
const roles = {
  admin: 'admin',
  manager: 'manager',
  worker: 'cashier',
  adminEmployee: 'admin',
  foreign: 'manager',
} as const;
const sqlite = () => (getDatabase() as unknown as { $client: Database.Database }).$client;
const context = (actor: keyof typeof roles = 'manager') =>
  freshCriticalContext({
    db: getDatabase(),
    serverApp: server.app,
    tenantId: actor === 'foreign' ? 'other' : 'tenant',
    userId: actor,
    email: `${actor}@example.test`,
    role: roles[actor],
    siteId: actor === 'foreign' ? 'foreign-site' : 'site',
    deviceId: devices.get(actor)!,
    sessionVersion: 1,
  });
const caller = (actor: keyof typeof roles = 'manager') => appRouter.createCaller(context(actor));
const recordInput = (overrides: Record<string, unknown> = {}) => ({
  scheduledShiftId: 'plan',
  scheduledShiftVersion: 1,
  expectedVersion: 0,
  outcome: 'attended' as const,
  employeeShiftId: 'actual',
  reason: 'Reviewed against the signed clock evidence',
  ...overrides,
});

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', seedData: false, verbose: false });
  sqlite().exec(`
    INSERT INTO tenants(id,name,slug,default_currency_code) VALUES
      ('tenant','Tenant','tenant','COP'),('other','Other','other','COP');
    INSERT INTO companies(id,tenant_id,name) VALUES
      ('company','tenant','Company'),('other-company','other','Other');
    INSERT INTO sites(id,tenant_id,company_id,name) VALUES
      ('site','tenant','company','Central'),
      ('other-site','tenant','company','North'),
      ('foreign-site','other','other-company','Foreign');
    INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES
      ('admin','tenant','Admin','admin@example.test','unused','admin'),
      ('manager','tenant','Manager','manager@example.test','unused','manager'),
      ('worker','tenant','Worker','worker@example.test','unused','cashier'),
      ('cost-worker','tenant','Cost Worker','cost-worker@example.test','unused','cashier'),
      ('monthly-worker','tenant','Monthly Worker','monthly-worker@example.test','unused','cashier'),
      ('adminEmployee','tenant','Admin Employee','adminEmployee@example.test','unused','admin'),
      ('foreign','other','Foreign','foreign@example.test','unused','manager');
    INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES ('tenant','CO'),('other','CO');
    INSERT INTO scheduled_shifts(
      id,tenant_id,user_id,site_id,starts_at,ends_at,time_zone,created_by_user_id,updated_by_user_id
    ) VALUES
      ('plan','tenant','worker','site','2026-09-01T13:00:00.000Z','2026-09-01T21:00:00.000Z','America/Bogota','manager','manager'),
      ('future-plan','tenant','worker','site','2030-09-01T13:00:00.000Z','2030-09-01T21:00:00.000Z','America/Bogota','manager','manager'),
      ('admin-plan','tenant','adminEmployee','site','2026-09-01T13:00:00.000Z','2026-09-01T21:00:00.000Z','America/Bogota','admin','admin'),
      ('foreign-plan','other','foreign','foreign-site','2026-09-01T13:00:00.000Z','2026-09-01T21:00:00.000Z','America/Bogota','foreign','foreign');
    INSERT INTO employee_shifts(
      id,tenant_id,user_id,site_id,clocked_in_at,clocked_out_at,created_at,updated_at
    ) VALUES
      ('actual','tenant','worker','other-site','2026-09-01T13:15:00.000Z','2026-09-01T20:45:00.000Z','2026-09-01T13:15:00.000Z','2026-09-01T20:45:00.000Z'),
      ('cost-actual','tenant','cost-worker','site','2026-09-02T13:00:00.000Z','2026-09-02T21:00:00.000Z','2026-09-02T13:00:00.000Z','2026-09-02T21:00:00.000Z'),
      ('monthly-actual','tenant','monthly-worker','site','2026-09-02T13:00:00.000Z','2026-09-02T17:00:00.000Z','2026-09-02T13:00:00.000Z','2026-09-02T17:00:00.000Z'),
      ('foreign-actual','other','foreign','foreign-site','2026-09-01T13:00:00.000Z','2026-09-01T21:00:00.000Z','2026-09-01T13:00:00.000Z','2026-09-01T21:00:00.000Z');
    INSERT INTO employee_shift_breaks(
      id,tenant_id,employee_shift_id,user_id,started_at,ended_at,started_by_user_id,ended_by_user_id,created_at,updated_at
    ) VALUES
      ('break','tenant','actual','worker','2026-09-01T17:00:00.000Z','2026-09-01T17:30:00.000Z','worker','worker','2026-09-01T17:00:00.000Z','2026-09-01T17:30:00.000Z'),
      ('cost-break','tenant','cost-actual','cost-worker','2026-09-02T17:00:00.000Z','2026-09-02T17:30:00.000Z','cost-worker','cost-worker','2026-09-02T17:00:00.000Z','2026-09-02T17:30:00.000Z');
    INSERT INTO employment_contracts(
      id,tenant_id,user_id,site_id,position,effective_from,effective_until,time_zone,currency_code,
      pay_basis,pay_amount,costing_hourly_rate,version,created_by_user_id,updated_by_user_id
    ) VALUES
      ('cost-contract','tenant','cost-worker','site','Cashier','2026-01-01',NULL,'America/Bogota','COP','hourly',10000,NULL,1,'admin','admin'),
      ('monthly-contract','tenant','monthly-worker','site','Supervisor','2026-01-01',NULL,'America/Bogota','COP','monthly',2000000,NULL,1,'admin','admin');
  `);
  for (const actor of Object.keys(roles) as Array<keyof typeof roles>) {
    const fixture = await createCriticalCommandFixture({
      db: getDatabase(),
      serverApp: server.app,
      tenantId: actor === 'foreign' ? 'other' : 'tenant',
      userId: actor,
      email: `${actor}@example.test`,
      role: roles[actor],
      siteId: actor === 'foreign' ? 'foreign-site' : 'site',
      sessionVersion: 1,
    });
    devices.set(actor, fixture.deviceId);
  }
});

afterAll(async () => {
  await server.close();
});

describe('employee attendance reconciliation', () => {
  it('keeps an ended plan pending until an explicit attended decision then derives exact variance', async () => {
    const before = await caller().employeeShifts.attendance.planActual.list({
      fromDate: '2026-09-01',
      toDate: '2026-09-02',
      limit: 10,
    });
    expect(before.items.find(row => row.scheduledShiftId === 'plan')).toMatchObject({
      state: 'needs_review',
      actual: null,
      reconciliation: null,
    });
    expect(
      await caller().employeeShifts.attendance.planActual.candidates({ scheduledShiftId: 'plan' })
    ).toEqual([
      expect.objectContaining({
        id: 'actual',
        siteId: 'other-site',
        breakSeconds: 1_800,
        workedSeconds: 25_200,
      }),
    ]);

    const result = await caller().employeeShifts.attendance.planActual.record(recordInput());
    expect(result).toMatchObject({ outcome: 'attended', version: 1 });
    const row = (
      await caller().employeeShifts.attendance.planActual.list({
        fromDate: '2026-09-01',
        toDate: '2026-09-02',
        limit: 10,
      })
    ).items.find(item => item.scheduledShiftId === 'plan');
    expect(row).toMatchObject({
      state: 'attended',
      plannedSeconds: 28_800,
      reconciliation: { outcome: 'attended', version: 1 },
      actual: {
        id: 'actual',
        siteMismatch: true,
        lateSeconds: 900,
        earlyDepartureSeconds: 900,
        overrunSeconds: 0,
        breakSeconds: 1_800,
        workedSeconds: 25_200,
        varianceSeconds: -3_600,
      },
    });

    const privateEvent = sqlite()
      .prepare('SELECT version,kind,reason FROM employee_shift_reconciliation_events')
      .get();
    expect(privateEvent).toEqual({
      version: 1,
      kind: 'created',
      reason: 'Reviewed against the signed clock evidence',
    });
    const generic = JSON.stringify({
      audit: sqlite()
        .prepare(
          'SELECT action,resource_type,"after" FROM audit_logs WHERE resource_type=\'attendance_reconciliation\''
        )
        .all(),
      outbox: sqlite()
        .prepare(
          "SELECT status,payload FROM sync_outbox WHERE entity_type='employee_shift_reconciliations'"
        )
        .all(),
    });
    expect(generic).not.toContain('Reviewed against');
    expect(generic).not.toContain('clocked_in_at');
    expect(resolveSyncTransportPolicy('employee_shift_reconciliations')).toBe('local_only');
    expect(isRemoteSyncApplyBlocked('employee_shift_reconciliations')).toBe(true);
  });

  it('uses the latest correction without rewriting the frozen plan and permits an audited no-show revision', async () => {
    sqlite().exec(`
      INSERT INTO employee_shift_corrections(
        id,tenant_id,employee_shift_id,version,clocked_in_at,clocked_out_at,breaks_json,reason,created_by_user_id,created_at
      ) VALUES (
        'correction','tenant','actual',1,'2026-09-01T13:05:00.000Z','2026-09-01T21:05:00.000Z','[]',
        'Manager reviewed the signed terminal log','manager','2026-09-02T10:00:00.000Z'
      );
    `);
    const corrected = (
      await caller().employeeShifts.attendance.planActual.list({
        fromDate: '2026-09-01',
        toDate: '2026-09-02',
        limit: 10,
      })
    ).items.find(item => item.scheduledShiftId === 'plan');
    expect(corrected?.actual).toMatchObject({
      correctionVersion: 1,
      lateSeconds: 300,
      overrunSeconds: 300,
      workedSeconds: 28_800,
      varianceSeconds: 0,
    });

    const revised = await caller().employeeShifts.attendance.planActual.record(
      recordInput({ expectedVersion: 1, outcome: 'no_show', employeeShiftId: null })
    );
    expect(revised).toMatchObject({ outcome: 'no_show', version: 2 });
    expect(
      sqlite()
        .prepare('SELECT version,kind FROM employee_shift_reconciliation_events ORDER BY version')
        .all()
    ).toEqual([
      { version: 1, kind: 'created' },
      { version: 2, kind: 'revised' },
    ]);
    expect(
      (
        await caller().employeeShifts.attendance.planActual.list({
          fromDate: '2026-09-01',
          toDate: '2026-09-02',
          limit: 10,
        })
      ).items.find(item => item.scheduledShiftId === 'plan')
    ).toMatchObject({ state: 'no_show', actual: null });
  });

  it('fails closed for future no-shows, stale versions, claimed attendance and tenant or role probes', async () => {
    await expect(
      caller().employeeShifts.attendance.planActual.record(
        recordInput({
          scheduledShiftId: 'future-plan',
          outcome: 'no_show',
          employeeShiftId: null,
        })
      )
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'ATTENDANCE_RECONCILIATION_NO_SHOW_EARLY' }),
    });
    await expect(
      caller().employeeShifts.attendance.planActual.record(recordInput())
    ).rejects.toMatchObject({ cause: expect.objectContaining({ errorCode: 'STALE_VERSION' }) });
    await expect(
      caller('foreign').employeeShifts.attendance.planActual.candidates({
        scheduledShiftId: 'plan',
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'ATTENDANCE_RECONCILIATION_NOT_FOUND' }),
    });
    await expect(
      caller().employeeShifts.attendance.planActual.candidates({ scheduledShiftId: 'admin-plan' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'ATTENDANCE_RECONCILIATION_NOT_FOUND' }),
    });
    await expect(
      caller('worker').employeeShifts.attendance.planActual.list({
        fromDate: '2026-09-01',
        toDate: '2026-09-02',
      })
    ).rejects.toThrow(/administrators and managers/);
  });

  it('freezes reconciled plans and enforces event and cross-tenant integrity in SQLite', async () => {
    expect(() =>
      sqlite().prepare("UPDATE scheduled_shifts SET notes='changed' WHERE id='plan'").run()
    ).toThrow(/ATTENDANCE_RECONCILIATION_PLAN_IMMUTABLE/);
    expect(() =>
      sqlite()
        .prepare('UPDATE employee_shift_reconciliation_events SET reason=?')
        .run('A different sufficiently long reason')
    ).toThrow(/ATTENDANCE_RECONCILIATION_EVENT_IMMUTABLE/);
    expect(() =>
      sqlite()
        .prepare(
          `INSERT INTO employee_shift_reconciliations(
            id,tenant_id,scheduled_shift_id,employee_shift_id,outcome,scheduled_shift_version,user_id,site_id,
            planned_starts_at,planned_ends_at,planned_time_zone,created_by_user_id,updated_by_user_id
          ) VALUES ('forged','tenant','foreign-plan','foreign-actual','attended',1,'foreign','foreign-site',
            '2026-09-01T13:00:00.000Z','2026-09-01T21:00:00.000Z','America/Bogota','manager','manager')`
        )
        .run()
    ).toThrow(/ATTENDANCE_RECONCILIATION_PLAN_INVALID/);
    expect(sqlite().prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('keeps operational cost admin-only and preserves unknown monthly costing time', async () => {
    const report = await caller('admin').employeeShifts.attendance.costs({
      fromDate: '2026-09-02',
      toDate: '2026-09-03',
    });
    expect(report).toMatchObject({
      kind: 'regular_operational_estimate',
      workedSeconds: 41_400,
      pricedSeconds: 27_000,
      unavailableSeconds: 14_400,
      totals: [{ currencyCode: 'COP', amount: 75_000 }],
      limitations: [
        'regular_time_only',
        'not_payroll',
        'no_statutory_premiums',
        'no_benefits_or_taxes',
      ],
    });
    expect(report.rows.find(row => row.employeeShiftId === 'monthly-actual')).toMatchObject({
      status: 'unavailable',
      unavailableSeconds: 14_400,
      reasons: ['monthly_costing_rate_missing'],
    });
    await expect(
      caller().employeeShifts.attendance.costs({
        fromDate: '2026-09-02',
        toDate: '2026-09-03',
      })
    ).rejects.toThrow(/administrators/);
  });
});
