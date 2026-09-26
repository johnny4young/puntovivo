/** Private payroll profile lifecycle, tenant isolation and atomic evidence. */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { auditLogs, payrollEmployeeProfileEvents, payrollEmployeeProfiles } from '../db/schema.js';
import {
  createPayrollProfile,
  endPayrollProfile,
  replacePayrollProfile,
  voidPayrollProfile,
} from '../application/payroll/profiles.js';
import type { WorkforceCommandContext } from '../application/workforce/writer.js';

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
function profile() {
  return {
    userId: 'worker',
    siteId: 'site',
    countryCode: 'CO' as const,
    identificationType: 'CC',
    identificationNumber: '123456789',
    contributorType: '01',
    contributorSubtype: null,
    contractKind: 'indefinite' as const,
    integralSalary: false,
    arlRiskClass: 1,
    healthEntity: 'EPS private',
    pensionEntity: 'Pension private',
    compensationFund: 'CCF private',
    transportAssistanceEligible: true,
    paymentMethod: 'transfer' as const,
    paymentAccountLast4: '4321',
    effectiveFrom: '2026-01-01',
    effectiveUntil: null,
  };
}
const reason = 'Reviewed private payroll profile evidence';
function target(row: { id: string; siteId: string; version: number }) {
  return { id: row.id, siteId: row.siteId, expectedVersion: row.version, reason };
}

beforeEach(async () => {
  await initDatabase({ dbPath: ':memory:', seedData: false });
  sqlite().exec(`
    INSERT INTO tenants(id,name,slug,default_currency_code) VALUES
      ('tenant','Tenant','tenant','COP'),('foreign','Foreign','foreign','COP');
    INSERT INTO companies(id,tenant_id,name) VALUES
      ('company','tenant','Company'),('foreign-company','foreign','Foreign');
    INSERT INTO sites(id,tenant_id,company_id,name) VALUES
      ('site','tenant','company','Central'),('site-two','tenant','company','Second'),
      ('foreign-site','foreign','foreign-company','Foreign');
    INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES
      ('admin','tenant','Admin','admin@example.test','unused','admin'),
      ('worker','tenant','Worker','worker@example.test','unused','cashier'),
      ('manager','tenant','Manager','manager@example.test','unused','manager'),
      ('foreign-admin','foreign','Foreign','foreign@example.test','unused','admin');
    INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES
      ('tenant','CO'),('foreign','CO');
  `);
});
afterEach(() => closeDatabase());

describe('payroll profile application service', () => {
  it('stores private history while audit and command completion remain minimal', async () => {
    const ctx = context({
      envelope: {
        // A legitimate opaque operation id may contain the same four digits
        // as a private bank-account suffix without leaking that account.
        operationId: '00000000-0000-4000-8000-000000004321',
        idempotencyKey: '00000000-0000-4000-8000-000000000001',
        clientCreatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const result = await createPayrollProfile(ctx, { profile: profile(), reason });
    const rows = getDatabase().select().from(payrollEmployeeProfiles).all();
    const events = getDatabase().select().from(payrollEmployeeProfileEvents).all();
    const audit = getDatabase().select().from(auditLogs).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 'worker',
      identificationNumber: '123456789',
      paymentAccountLast4: '4321',
      version: 1,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'created', reason, before: null });
    expect(ctx.completeInTransaction).toHaveBeenCalledExactlyOnceWith(expect.anything(), result);
    // Assert the complete public result and every audit field that may carry
    // user data. Opaque ids and integrity hashes can coincidentally contain
    // the same four digits as a private account suffix without leaking it.
    expect(result).toEqual({
      id: expect.any(String),
      siteId: 'site',
      version: 1,
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual({
      id: expect.any(String),
      tenantId: 'tenant',
      actorId: 'admin',
      action: 'payroll_profile.changed',
      resourceType: 'payroll_profile',
      resourceId: result.id,
      before: null,
      after: { version: 1, siteId: 'site', kind: 'created' },
      metadata: null,
      operationId: ctx.envelope.operationId,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      prevHash: 'genesis',
      chainHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      redactedAt: null,
      createdAt: expect.any(String),
    });
  });

  it('replaces an interval atomically and never rewrites the previous snapshot', async () => {
    const original = await createPayrollProfile(context(), {
      profile: { ...profile(), effectiveUntil: '2027-01-01' },
      reason,
    });
    const replacement = await replacePayrollProfile(context(), {
      ...target(original),
      profile: {
        ...profile(),
        siteId: 'site-two',
        effectiveFrom: '2026-07-01',
        effectiveUntil: '2027-01-01',
        arlRiskClass: 2,
      },
    });
    const rows = getDatabase().select().from(payrollEmployeeProfiles).all();
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === original.id)).toMatchObject({
      effectiveUntil: '2026-07-01',
      version: 2,
      arlRiskClass: 1,
    });
    expect(rows.find(row => row.id === replacement.id)).toMatchObject({
      siteId: 'site-two',
      predecessorId: original.id,
      version: 1,
      arlRiskClass: 2,
    });
    expect(getDatabase().select().from(payrollEmployeeProfileEvents).all()).toHaveLength(3);
  });

  it('rolls back replacement, audit and private events when completion fails', async () => {
    const original = await createPayrollProfile(context(), {
      profile: { ...profile(), effectiveUntil: '2027-01-01' },
      reason,
    });
    const before = {
      rows: getDatabase().select().from(payrollEmployeeProfiles).all(),
      events: getDatabase().select().from(payrollEmployeeProfileEvents).all(),
      audit: getDatabase().select().from(auditLogs).all(),
    };
    await expect(
      replacePayrollProfile(
        context({
          completeInTransaction: vi.fn(() => {
            throw new Error('Injected completion fault');
          }),
        }),
        {
          ...target(original),
          profile: {
            ...profile(),
            effectiveFrom: '2026-07-01',
            effectiveUntil: '2027-01-01',
          },
        }
      )
    ).rejects.toThrow('Injected completion fault');
    expect({
      rows: getDatabase().select().from(payrollEmployeeProfiles).all(),
      events: getDatabase().select().from(payrollEmployeeProfileEvents).all(),
      audit: getDatabase().select().from(auditLogs).all(),
    }).toEqual(before);
  });

  it('rejects overlaps, foreign rows, stale versions and non-admin actors', async () => {
    const original = await createPayrollProfile(context(), { profile: profile(), reason });
    await expect(
      createPayrollProfile(context(), {
        profile: { ...profile(), siteId: 'site-two', effectiveFrom: '2026-06-01' },
        reason,
      })
    ).rejects.toMatchObject({ reason: 'profile_overlap' });
    await expect(
      voidPayrollProfile(context(), { ...target(original), expectedVersion: 99 })
    ).rejects.toMatchObject({
      reason: 'version',
    });
    await expect(
      voidPayrollProfile(
        context({
          tenantId: 'foreign',
          user: {
            id: 'foreign-admin',
            role: 'admin',
            email: 'foreign@example.test',
            tenantId: 'foreign',
          },
        }),
        { ...target(original), siteId: 'foreign-site' }
      )
    ).rejects.toMatchObject({ reason: 'not_found' });
    await expect(
      createPayrollProfile(
        context({ user: { ...context().user, id: 'manager', role: 'manager' } }),
        { profile: profile(), reason }
      )
    ).rejects.toMatchObject({ cause: { errorCode: 'AUTH_IDENTITY_CHANGED' } });
  });

  it('preserves an ended or voided profile as non-reactivatable evidence', async () => {
    const original = await createPayrollProfile(context(), { profile: profile(), reason });
    const ended = await endPayrollProfile(context(), {
      ...target(original),
      effectiveUntil: '2026-06-01',
    });
    const voided = await voidPayrollProfile(context(), target(ended));
    await expect(
      endPayrollProfile(context(), { ...target(voided), effectiveUntil: '2026-04-01' })
    ).rejects.toMatchObject({ reason: 'state' });
    expect(
      getDatabase()
        .select()
        .from(payrollEmployeeProfileEvents)
        .all()
        .map(row => row.kind)
    ).toEqual(['created', 'ended', 'voided']);
  });
});
