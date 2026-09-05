/** Private pre-payroll transport, replay, authorization, isolation and pagination. */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import {
  auditLogs,
  employmentContracts,
  idempotencyKeys,
  payrollEmployeeProfileEvents,
} from '../db/schema.js';
import { registerDevice } from '../services/devices/devicesService.js';
import type { Context } from '../trpc/context.js';
import { appRouter } from '../trpc/router.js';
import type { CommandEnvelope } from '../trpc/schemas/envelope.js';
import type { PayrollEmployeeSettlementInput } from '../trpc/schemas/payroll.js';
import { freshCriticalContext } from './utils/criticalCommandFixture.js';

function sqlite() {
  return (getDatabase() as unknown as { $client: Database.Database }).$client;
}

let tenantDeviceId: string;
let foreignDeviceId: string;

function context(
  overrides: {
    tenantId?: 'tenant' | 'foreign';
    role?: 'admin' | 'manager';
    envelope?: CommandEnvelope;
  } = {}
): Context {
  const tenantId = overrides.tenantId ?? 'tenant';
  const foreign = tenantId === 'foreign';
  const role = overrides.role ?? 'admin';
  return freshCriticalContext({
    db: getDatabase(),
    serverApp: { db: getDatabase() },
    tenantId,
    userId: foreign ? 'foreign-admin' : role === 'manager' ? 'manager' : 'admin',
    email: foreign ? 'foreign-admin@example.test' : `${role}@example.test`,
    role,
    siteId: foreign ? 'foreign-site' : 'site',
    deviceId: foreign ? foreignDeviceId : tenantDeviceId,
    envelope: overrides.envelope,
  });
}

function profile(userId: string, effectiveFrom = '2026-01-01') {
  return {
    userId,
    siteId: 'site',
    countryCode: 'CO' as const,
    identificationType: 'CC',
    identificationNumber: `1000-${userId}`,
    contributorType: '01',
    contributorSubtype: null,
    contractKind: 'indefinite' as const,
    integralSalary: false,
    arlRiskClass: 1,
    healthEntity: 'Private health entity',
    pensionEntity: 'Private pension entity',
    compensationFund: 'Private compensation fund',
    transportAssistanceEligible: false,
    paymentMethod: 'cash' as const,
    paymentAccountLast4: null,
    effectiveFrom,
    effectiveUntil: null,
  };
}

function settlement(userId: string): PayrollEmployeeSettlementInput {
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
      reason: 'Reviewed withholding for the current payroll period',
    },
    benefitsReviewed: true,
    reviewReason: 'Reviewed against private employee payroll evidence',
    manualConcepts: [],
  };
}

const privateReason = 'Reviewed private payroll transport evidence';
const periodInput = {
  countryCode: 'CO' as const,
  frequency: 'monthly' as const,
  fromDate: '2026-08-01',
  untilDate: '2026-09-01',
  payDate: '2026-09-05',
  currencyCode: 'COP' as const,
  reason: 'Reviewed August payroll calendar evidence',
};

async function createProfile(userId: string, effectiveFrom = '2026-01-01') {
  return appRouter.createCaller(context()).workforce.payroll.profiles.create({
    profile: profile(userId, effectiveFrom),
    reason: privateReason,
  });
}

beforeEach(async () => {
  await initDatabase({ dbPath: ':memory:', seedData: false });
  sqlite().exec(`
    INSERT INTO tenants(id,name,slug,default_currency_code) VALUES
      ('tenant','Tenant','tenant-payroll-router','COP'),
      ('foreign','Foreign','foreign-payroll-router','COP');
    INSERT INTO companies(id,tenant_id,name) VALUES
      ('company','tenant','Company'),('foreign-company','foreign','Foreign Company');
    INSERT INTO sites(id,tenant_id,company_id,name) VALUES
      ('site','tenant','company','Central'),
      ('foreign-site','foreign','foreign-company','Foreign');
    INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES
      ('admin','tenant','Admin','admin@example.test','unused','admin'),
      ('manager','tenant','Manager','manager@example.test','unused','manager'),
      ('worker-a','tenant','Worker A','worker-a@example.test','unused','cashier'),
      ('worker-b','tenant','Worker B','worker-b@example.test','unused','cashier'),
      ('worker-c','tenant','Worker C','worker-c@example.test','unused','cashier'),
      ('foreign-admin','foreign','Foreign Admin','foreign-admin@example.test','unused','admin'),
      ('foreign-worker','foreign','Foreign Worker','foreign-worker@example.test','unused','cashier');
    INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES
      ('tenant','CO'),('foreign','CO');
  `);
  tenantDeviceId = (
    await registerDevice(getDatabase(), {
      tenantId: 'tenant',
      userId: 'admin',
      kind: 'web',
      name: 'payroll-router.test',
    })
  ).deviceId;
  foreignDeviceId = (
    await registerDevice(getDatabase(), {
      tenantId: 'foreign',
      userId: 'foreign-admin',
      kind: 'web',
      name: 'payroll-router.foreign.test',
    })
  ).deviceId;
});

afterEach(() => closeDatabase());

describe('payroll tRPC router', () => {
  it('replays an exact command, rejects a mismatched replay and keeps public evidence minimal', async () => {
    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const input = { profile: profile('worker-a'), reason: privateReason };
    const created = await appRouter
      .createCaller(context({ envelope }))
      .workforce.payroll.profiles.create(input);
    const replayed = await appRouter
      .createCaller(context({ envelope }))
      .workforce.payroll.profiles.create(input);
    expect(replayed).toEqual(created);
    await expect(
      appRouter
        .createCaller(context({ envelope }))
        .workforce.payroll.profiles.create({ ...input, reason: `${privateReason} changed` })
    ).rejects.toMatchObject({ cause: { errorCode: 'IDEMPOTENCY_KEY_CONFLICT' } });

    const publicEvidence = JSON.stringify({
      idempotency: getDatabase().select().from(idempotencyKeys).all(),
      audit: getDatabase().select().from(auditLogs).all(),
    });
    expect(publicEvidence).not.toContain(privateReason);
    expect(publicEvidence).not.toContain(input.profile.identificationNumber);
    expect(getDatabase().select().from(payrollEmployeeProfileEvents).all()).toHaveLength(1);
  });

  it('maps aggregate-specific failures and rejects non-administrator access', async () => {
    const caller = appRouter.createCaller(context());
    await caller.workforce.payroll.periods.create(periodInput);
    await expect(
      appRouter.createCaller(context()).workforce.payroll.periods.create({
        ...periodInput,
        frequency: 'biweekly',
        fromDate: '2026-08-15',
        untilDate: '2026-08-31',
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PAYROLL_PERIOD_OVERLAP' } });
    await expect(
      appRouter.createCaller(context()).workforce.payroll.periods.create({
        ...periodInput,
        fromDate: '2027-01-01',
        untilDate: '2027-02-01',
        payDate: '2027-02-05',
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PAYROLL_POLICY_UNAVAILABLE' } });
    await expect(
      appRouter
        .createCaller(context({ role: 'manager' }))
        .workforce.payroll.profiles.list({ limit: 10 })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('paginates private profile reads and never crosses the tenant boundary', async () => {
    const own = await Promise.all([
      createProfile('worker-a', '2026-01-01'),
      createProfile('worker-b', '2026-02-01'),
      createProfile('worker-c', '2026-03-01'),
    ]);
    const foreign = await appRouter
      .createCaller(context({ tenantId: 'foreign' }))
      .workforce.payroll.profiles.create({
        profile: { ...profile('foreign-worker'), siteId: 'foreign-site' },
        reason: privateReason,
      });
    const caller = appRouter.createCaller(context());
    const first = await caller.workforce.payroll.profiles.list({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await caller.workforce.payroll.profiles.list({
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect([...first.items, ...second.items].map(row => row.id).sort()).toEqual(
      own.map(row => row.id).sort()
    );
    expect(second.nextCursor).toBeNull();
    await expect(
      caller.workforce.payroll.profiles.get({ id: foreign.id, siteId: 'site' })
    ).rejects.toMatchObject({ cause: { errorCode: 'PAYROLL_NOT_FOUND' } });
  });

  it('returns bounded employee revision pages with their frozen concepts and sources', async () => {
    await Promise.all([createProfile('worker-a'), createProfile('worker-b')]);
    const now = '2026-08-01T12:00:00.000Z';
    await getDatabase()
      .insert(employmentContracts)
      .values([
        {
          id: 'contract-a',
          tenantId: 'tenant',
          userId: 'worker-a',
          siteId: 'site',
          position: 'Operator',
          effectiveFrom: '2026-01-01',
          timeZone: 'America/Bogota',
          currencyCode: 'COP',
          payBasis: 'monthly',
          payAmount: 2_000_000,
          createdByUserId: 'admin',
          updatedByUserId: 'admin',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'contract-b',
          tenantId: 'tenant',
          userId: 'worker-b',
          siteId: 'site',
          position: 'Operator',
          effectiveFrom: '2026-01-01',
          timeZone: 'America/Bogota',
          currencyCode: 'COP',
          payBasis: 'monthly',
          payAmount: 2_000_000,
          createdByUserId: 'admin',
          updatedByUserId: 'admin',
          createdAt: now,
          updatedAt: now,
        },
      ]);
    const period = await appRouter
      .createCaller(context())
      .workforce.payroll.periods.create(periodInput);
    const run = await appRouter.createCaller(context()).workforce.payroll.runs.create({
      periodId: period.id,
      kind: 'regular',
      originalRunId: null,
      reason: 'Created regular payroll run for private review',
    });
    const preparation = await appRouter
      .createCaller(context())
      .workforce.payroll.runs.preparation({ runId: run.id });
    expect(preparation).toMatchObject({
      kind: 'regular',
      ready: true,
      employees: [
        expect.objectContaining({ userId: 'worker-a', payBasis: 'monthly' }),
        expect.objectContaining({ userId: 'worker-b', payBasis: 'monthly' }),
      ],
    });
    await expect(
      appRouter.createCaller(context()).workforce.payroll.runs.recalculate({
        runId: run.id,
        expectedVersion: run.version,
        authorityToken: preparation.authorityToken,
        policyAcknowledged: true,
        employees: [settlement('worker-a')],
        reason: 'Attempt to omit an authoritative payroll employee',
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PAYROLL_EMPLOYEE_SET_CHANGED' } });
    const calculated = await appRouter.createCaller(context()).workforce.payroll.runs.recalculate({
      runId: run.id,
      expectedVersion: run.version,
      authorityToken: preparation.authorityToken,
      policyAcknowledged: true,
      employees: [settlement('worker-a'), settlement('worker-b')],
      reason: 'Calculated reviewed employee payroll evidence',
    });
    expect(calculated).toMatchObject({ currentRevision: 1, version: 2 });
    await expect(
      appRouter.createCaller(context()).workforce.payroll.runs.create({
        periodId: period.id,
        kind: 'regular',
        originalRunId: null,
        reason: 'Attempted duplicate regular payroll run',
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'PAYROLL_REGULAR_RUN_EXISTS' } });

    const caller = appRouter.createCaller(context());
    const first = await caller.workforce.payroll.runs.revision({
      runId: run.id,
      revision: 1,
      limit: 1,
    });
    expect(first.revision).toMatchObject({ status: 'complete', revision: 1 });
    expect(first.employees).toHaveLength(1);
    expect(first.employees[0]?.concepts.length).toBeGreaterThan(0);
    expect(first.employees[0]?.sources.map(source => source.kind).sort()).toEqual([
      'employment_contract',
      'payroll_profile',
      'policy',
    ]);
    const second = await caller.workforce.payroll.runs.revision({
      runId: run.id,
      revision: 1,
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.employees).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.employees[0]?.userId).not.toBe(first.employees[0]?.userId);
    expect(
      getDatabase()
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.status, 'succeeded'))
        .all().length
    ).toBeGreaterThanOrEqual(5);
  });
});
