/** Payroll period lifecycle, close preconditions, tenant isolation and private reasons. */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closePayrollPeriod, createPayrollPeriod } from '../application/payroll/periods.js';
import type { WorkforceCommandContext } from '../application/workforce/writer.js';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { auditLogs, payrollPeriods } from '../db/schema.js';

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

const createInput = {
  countryCode: 'CO' as const,
  frequency: 'monthly' as const,
  fromDate: '2026-08-01',
  untilDate: '2026-09-01',
  payDate: '2026-09-05',
  currencyCode: 'COP' as const,
  reason: 'Reviewed August payroll calendar',
};

function approveRegularRun(periodId: string, runId = 'regular-run'): void {
  const now = '2026-09-04T12:00:00.000Z';
  sqlite()
    .prepare(
      `INSERT INTO payroll_runs(
        id,tenant_id,period_id,kind,status,current_revision,version,created_by_user_id
      ) VALUES (?,?,?,'regular','draft',0,1,'admin')`
    )
    .run(runId, 'tenant', periodId);
  sqlite()
    .prepare(
      `UPDATE payroll_runs SET current_revision=1,version=2,updated_at=?
       WHERE tenant_id='tenant' AND id=?`
    )
    .run(now, runId);
  sqlite()
    .prepare(
      `UPDATE payroll_runs SET
        status='reviewed',reviewed_revision=1,reviewed_by_user_id='admin',reviewed_at=?,
        version=3,updated_at=? WHERE tenant_id='tenant' AND id=?`
    )
    .run(now, now, runId);
  sqlite()
    .prepare(
      `UPDATE payroll_runs SET
        status='approved',approved_revision=1,approved_by_user_id='admin',approved_at=?,
        version=4,updated_at=? WHERE tenant_id='tenant' AND id=?`
    )
    .run(now, now, runId);
}

beforeEach(async () => {
  await initDatabase({ dbPath: ':memory:', seedData: false });
  sqlite().exec(`
    INSERT INTO tenants(id,name,slug,default_currency_code) VALUES
      ('tenant','Tenant','tenant-periods','COP'),('foreign','Foreign','foreign-periods','COP');
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

describe('payroll period application service', () => {
  it('creates one private period while audit and command completion remain minimal', async () => {
    const ctx = context();
    const result = await createPayrollPeriod(ctx, createInput);
    expect(getDatabase().select().from(payrollPeriods).all()).toMatchObject([
      {
        id: result.id,
        status: 'open',
        version: 1,
        createdReason: createInput.reason,
        closedReason: null,
      },
    ]);
    expect(ctx.completeInTransaction).toHaveBeenCalledExactlyOnceWith(expect.anything(), result);
    const publicEvidence = JSON.stringify({
      result,
      audit: getDatabase()
        .select()
        .from(auditLogs)
        .all()
        .map(row => ({ before: row.before, after: row.after, metadata: row.metadata })),
    });
    expect(publicEvidence).not.toContain(createInput.reason);
    expect(publicEvidence).not.toContain(createInput.payDate);
  });

  it('rejects exact or partial overlap, an unsupported country and a currency mismatch', async () => {
    await createPayrollPeriod(context(), createInput);
    await expect(
      createPayrollPeriod(context(), {
        ...createInput,
        frequency: 'biweekly',
        fromDate: '2026-08-15',
        untilDate: '2026-08-31',
      })
    ).rejects.toMatchObject({ reason: 'period_overlap' });
    sqlite()
      .prepare("UPDATE tenant_locale_settings SET country_code='MX' WHERE tenant_id='tenant'")
      .run();
    await expect(
      createPayrollPeriod(context(), {
        ...createInput,
        fromDate: '2026-10-01',
        untilDate: '2026-11-01',
        payDate: '2026-11-05',
      })
    ).rejects.toMatchObject({ reason: 'country' });
    sqlite()
      .prepare("UPDATE tenant_locale_settings SET country_code='CO' WHERE tenant_id='tenant'")
      .run();
    sqlite().prepare("UPDATE tenants SET default_currency_code='USD' WHERE id='tenant'").run();
    await expect(
      createPayrollPeriod(context(), {
        ...createInput,
        fromDate: '2026-10-01',
        untilDate: '2026-11-01',
        payDate: '2026-11-05',
      })
    ).rejects.toMatchObject({ reason: 'currency' });
  });

  it('fails closed when a period crosses a policy transition or lacks a reviewed policy', async () => {
    await expect(
      createPayrollPeriod(context(), {
        ...createInput,
        fromDate: '2026-07-01',
        untilDate: '2026-07-16',
        payDate: '2026-07-20',
      })
    ).rejects.toMatchObject({ reason: 'policy' });
    await expect(
      createPayrollPeriod(context(), {
        ...createInput,
        fromDate: '2027-01-01',
        untilDate: '2027-02-01',
        payDate: '2027-02-05',
      })
    ).rejects.toMatchObject({ reason: 'policy' });
  });

  it('closes only after the regular run is approved and no run remains unfinished', async () => {
    const period = await createPayrollPeriod(context(), createInput);
    await expect(
      closePayrollPeriod(context(), {
        id: period.id,
        expectedVersion: period.version,
        reason: 'Reconciled and approved August payroll',
      })
    ).rejects.toMatchObject({ reason: 'blocked' });
    approveRegularRun(period.id);
    sqlite()
      .prepare(
        `INSERT INTO payroll_runs(
          id,tenant_id,period_id,kind,original_run_id,created_by_user_id
        ) VALUES ('draft-adjustment','tenant',?,'adjustment','regular-run','admin')`
      )
      .run(period.id);
    await expect(
      closePayrollPeriod(context(), {
        id: period.id,
        expectedVersion: period.version,
        reason: 'Reconciled and approved August payroll',
      })
    ).rejects.toMatchObject({ reason: 'blocked' });
    const now = '2026-09-04T12:00:00.000Z';
    sqlite()
      .prepare(
        `UPDATE payroll_runs SET current_revision=1,version=2,updated_at=?
         WHERE tenant_id='tenant' AND id='draft-adjustment'`
      )
      .run(now);
    sqlite()
      .prepare(
        `UPDATE payroll_runs SET
          status='reviewed',reviewed_revision=1,reviewed_by_user_id='admin',reviewed_at=?,
          version=3,updated_at=? WHERE tenant_id='tenant' AND id='draft-adjustment'`
      )
      .run(now, now);
    sqlite()
      .prepare(
        `UPDATE payroll_runs SET
          status='approved',approved_revision=1,approved_by_user_id='admin',approved_at=?,
          version=4,updated_at=? WHERE tenant_id='tenant' AND id='draft-adjustment'`
      )
      .run(now, now);
    const ctx = context();
    const closed = await closePayrollPeriod(ctx, {
      id: period.id,
      expectedVersion: period.version,
      reason: 'Reconciled and approved August payroll',
    });
    expect(closed).toMatchObject({ id: period.id, status: 'closed', version: 2 });
    expect(getDatabase().select().from(payrollPeriods).get()).toMatchObject({
      status: 'closed',
      closedReason: 'Reconciled and approved August payroll',
      closedByUserId: 'admin',
    });
    expect(ctx.completeInTransaction).toHaveBeenCalledExactlyOnceWith(expect.anything(), closed);
  });

  it('rejects stale, foreign and non-administrator changes', async () => {
    const period = await createPayrollPeriod(context(), createInput);
    await expect(
      closePayrollPeriod(context(), {
        id: period.id,
        expectedVersion: 99,
        reason: 'Attempt with a stale period version',
      })
    ).rejects.toMatchObject({ reason: 'version' });
    await expect(
      closePayrollPeriod(
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
          id: period.id,
          expectedVersion: period.version,
          reason: 'Attempt against a foreign period row',
        }
      )
    ).rejects.toMatchObject({ reason: 'not_found' });
    await expect(
      createPayrollPeriod(
        context({ user: { ...context().user, id: 'manager', role: 'manager' } }),
        {
          ...createInput,
          fromDate: '2026-10-01',
          untilDate: '2026-11-01',
          payDate: '2026-11-05',
        }
      )
    ).rejects.toMatchObject({ cause: { errorCode: 'AUTH_IDENTITY_CHANGED' } });
  });

  it('rolls back close, audit and private reason if command completion fails', async () => {
    const period = await createPayrollPeriod(context(), createInput);
    approveRegularRun(period.id);
    const before = {
      period: getDatabase().select().from(payrollPeriods).get(),
      audit: getDatabase().select().from(auditLogs).all(),
    };
    await expect(
      closePayrollPeriod(
        context({
          completeInTransaction: vi.fn(() => {
            throw new Error('Injected completion fault');
          }),
        }),
        {
          id: period.id,
          expectedVersion: period.version,
          reason: 'Reconciled and approved August payroll',
        }
      )
    ).rejects.toThrow('Injected completion fault');
    expect({
      period: getDatabase().select().from(payrollPeriods).get(),
      audit: getDatabase().select().from(auditLogs).all(),
    }).toEqual(before);
  });

  it('enforces overlap, immutable creation evidence and no-delete at the SQLite boundary', async () => {
    const period = await createPayrollPeriod(context(), createInput);
    expect(() =>
      sqlite()
        .prepare(
          `INSERT INTO payroll_periods(
            id,tenant_id,country_code,frequency,from_date,until_date,pay_date,currency_code,
            created_reason,created_by_user_id
          ) VALUES (
            'overlap','tenant','CO','biweekly','2026-08-15','2026-08-31','2026-09-01','COP',
            'Overlapping raw period fixture','admin'
          )`
        )
        .run()
    ).toThrow(/PAYROLL_PERIOD_OVERLAP/);
    expect(() =>
      sqlite()
        .prepare(
          "UPDATE payroll_periods SET created_reason='Rewritten reason is forbidden' WHERE id=?"
        )
        .run(period.id)
    ).toThrow(/PAYROLL_PERIOD_TRANSITION_INVALID/);
    expect(() => sqlite().prepare('DELETE FROM payroll_periods WHERE id=?').run(period.id)).toThrow(
      /PAYROLL_PERIOD_DELETE_FORBIDDEN/
    );
  });
});
