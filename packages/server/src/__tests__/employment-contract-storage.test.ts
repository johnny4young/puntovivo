/** Migrated SQLite contract authority, confidentiality and atomic interval replacement. */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import {
  auditLogs,
  employmentContracts,
  employmentContractEvents,
  tenantLocaleSettings,
  users,
} from '../db/schema.js';
import {
  createEmploymentContract,
  endEmploymentContract,
  replaceEmploymentContract,
  voidEmploymentContract,
  type EmploymentContractCommandContext,
} from '../application/workforce/contracts.js';

function sqlite() {
  return (getDatabase() as unknown as { $client: Database.Database }).$client;
}
function context(
  overrides: Partial<EmploymentContractCommandContext> = {}
): EmploymentContractCommandContext {
  return {
    db: getDatabase(),
    tenantId: 'a',
    user: { id: 'admin', role: 'admin', email: 'admin@example.test', tenantId: 'a' },
    envelope: {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    },
    completeInTransaction: vi.fn(),
    ...overrides,
  };
}
function terms() {
  return {
    userId: 'worker',
    siteId: 'site-a',
    position: 'Private job title',
    effectiveFrom: '2026-01-01',
    effectiveUntil: null,
    currencyCode: 'COP',
    pay: { basis: 'hourly' as const, amount: 31111.11 },
  };
}
const reason = 'Private administrative explanation';
function rows() {
  return getDatabase().select().from(employmentContracts).all();
}
function events() {
  return getDatabase().select().from(employmentContractEvents).all();
}
function target(row: { id: string; siteId: string; version: number }) {
  return { id: row.id, siteId: row.siteId, expectedVersion: row.version, reason };
}

beforeEach(async () => {
  await initDatabase({ dbPath: ':memory:', seedData: false });
  sqlite().exec(`
    INSERT INTO tenants(id,name,slug,default_currency_code) VALUES ('a','A','a','COP'),('b','B','b','COP');
    INSERT INTO companies(id,tenant_id,name) VALUES ('company-a','a','A'),('company-b','b','B');
    INSERT INTO sites(id,tenant_id,company_id,name) VALUES
      ('site-a','a','company-a','A'),('site-a2','a','company-a','A2'),('site-b','b','company-b','B');
    INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES
      ('admin','a','Admin','admin@example.test','unused','admin'),
      ('worker','a','Worker','worker@example.test','unused','cashier'),
      ('foreign','b','Foreign','foreign@example.test','unused','admin');
    INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES ('a','CO'),('b','CO');
  `);
});
afterEach(() => closeDatabase());

describe('employment contract storage', () => {
  it('stores explicit terms and private evidence, but completion/audit never disclose wages or notes', async () => {
    const ctx = context();
    const result = await createEmploymentContract(ctx, { terms: terms(), reason });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      payAmount: 31111.11,
      payBasis: 'hourly',
      costingHourlyRate: null,
      timeZone: 'America/Bogota',
    });
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      kind: 'created',
      reason,
      before: null,
      after: { terms: terms(), version: 1 },
    });
    expect(result).toEqual({ id: rows()[0]!.id, siteId: 'site-a', version: 1 });
    expect(ctx.completeInTransaction).toHaveBeenCalledExactlyOnceWith(expect.anything(), result);
    const audit = getDatabase().select().from(auditLogs).all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'employment_contract.changed',
      operationId: ctx.envelope.operationId,
    });
    const publicEvidence = JSON.stringify({ audit, result });
    for (const secret of ['31111.11', reason, terms().position, 'payAmount', 'costingHourlyRate'])
      expect(publicEvidence).not.toContain(secret);
  });

  it('rejects raw rewrites and deletion of private contract evidence', async () => {
    await createEmploymentContract(context(), { terms: terms(), reason });
    expect(() =>
      sqlite().exec("UPDATE employment_contract_events SET reason='Attempted evidence rewrite'")
    ).toThrow(/EMPLOYMENT_CONTRACT_EVENT_IMMUTABLE/);
    expect(() => sqlite().exec('DELETE FROM employment_contract_events')).toThrow(
      /EMPLOYMENT_CONTRACT_EVENT_IMMUTABLE/
    );
    expect(events()).toHaveLength(1);
    expect(events()[0]?.reason).toBe(reason);
  });

  it('keeps monthly operational rate unknown and never changes the employee access role', async () => {
    await createEmploymentContract(context(), {
      terms: { ...terms(), pay: { basis: 'monthly', amount: 2000000 } },
      reason,
    });
    expect(rows()[0]).toMatchObject({ payAmount: 2000000, costingHourlyRate: null });
    expect(getDatabase().select().from(users).where(eq(users.id, 'worker')).get()!.role).toBe(
      'cashier'
    );
  });

  it('rejects overlaps across sites, including an open-ended existing period', async () => {
    await createEmploymentContract(context(), { terms: terms(), reason });
    await expect(
      createEmploymentContract(context(), {
        terms: { ...terms(), siteId: 'site-a2', effectiveFrom: '2026-02-01' },
        reason,
      })
    ).rejects.toMatchObject({ reason: 'overlap' });
    expect(rows()).toHaveLength(1);
    expect(events()).toHaveLength(1);
  });

  it('allows adjoining half-open periods without overlapping a calendar day', async () => {
    await createEmploymentContract(context(), {
      terms: { ...terms(), effectiveUntil: '2026-02-01' },
      reason,
    });
    await createEmploymentContract(context(), {
      terms: { ...terms(), effectiveFrom: '2026-02-01' },
      reason,
    });
    expect(rows()).toHaveLength(2);
  });

  it('replaces salary and site atomically, retaining old pay and original calendar zone', async () => {
    const original = await createEmploymentContract(context(), {
      terms: { ...terms(), effectiveUntil: '2027-01-01' },
      reason,
    });
    getDatabase()
      .update(tenantLocaleSettings)
      .set({ timezoneOverride: 'America/Lima', version: 1 })
      .where(eq(tenantLocaleSettings.tenantId, 'a'))
      .run();
    const result = await replaceEmploymentContract(context(), {
      ...target(original),
      terms: {
        ...terms(),
        siteId: 'site-a2',
        effectiveFrom: '2026-07-01',
        effectiveUntil: '2027-01-01',
        pay: { basis: 'hourly', amount: 40000 },
      },
    });
    expect(rows()).toHaveLength(2);
    expect(rows().find(r => r.id === original.id)).toMatchObject({
      version: 2,
      payAmount: 31111.11,
      effectiveUntil: '2026-07-01',
    });
    expect(rows().find(r => r.id === result.id)).toMatchObject({
      version: 1,
      payAmount: 40000,
      predecessorId: original.id,
      timeZone: 'America/Bogota',
    });
    expect(events()).toHaveLength(3);
    expect(events().find(e => e.kind === 'replaced')).toMatchObject({
      before: { terms: { effectiveUntil: '2027-01-01' } },
      after: { terms: { effectiveUntil: '2026-07-01' } },
    });
  });

  it('rolls back both replacement intervals and evidence when the completion fence fails', async () => {
    const original = await createEmploymentContract(context(), { terms: terms(), reason });
    const before = {
      rows: rows(),
      events: events(),
      audit: getDatabase().select().from(auditLogs).all(),
    };
    const completeInTransaction = vi.fn(() => {
      throw new Error('Injected completion fault');
    });
    await expect(
      replaceEmploymentContract(context({ completeInTransaction }), {
        ...target(original),
        terms: { ...terms(), effectiveFrom: '2026-07-01' },
      })
    ).rejects.toThrow('Injected completion fault');
    expect({
      rows: rows(),
      events: events(),
      audit: getDatabase().select().from(auditLogs).all(),
    }).toEqual(before);
    expect(completeInTransaction).toHaveBeenCalledOnce();
  });

  it('rolls back creation if private event insertion fails', async () => {
    sqlite().exec(
      "CREATE TRIGGER reject_contract_event BEFORE INSERT ON employment_contract_events BEGIN SELECT RAISE(ABORT, 'Injected event fault'); END"
    );
    const ctx = context();
    await expect(createEmploymentContract(ctx, { terms: terms(), reason })).rejects.toThrow();
    expect(rows()).toEqual([]);
    expect(events()).toEqual([]);
    expect(getDatabase().select().from(auditLogs).all()).toEqual([]);
    expect(ctx.completeInTransaction).not.toHaveBeenCalled();
  });

  it('rejects stale updates and preserves voided evidence without reactivation', async () => {
    const original = await createEmploymentContract(context(), { terms: terms(), reason });
    const ended = await endEmploymentContract(context(), {
      ...target(original),
      effectiveUntil: '2026-07-01',
    });
    await expect(voidEmploymentContract(context(), target(original))).rejects.toMatchObject({
      reason: 'version',
    });
    const voided = await voidEmploymentContract(context(), target(ended));
    await expect(
      endEmploymentContract(context(), { ...target(voided), effectiveUntil: '2026-06-01' })
    ).rejects.toMatchObject({ reason: 'state' });
    expect(events().map(e => e.kind)).toEqual(['created', 'ended', 'voided']);
    await createEmploymentContract(context(), { terms: terms(), reason });
    expect(rows()).toHaveLength(2);
    expect(rows()[0]!.voidedAt).not.toBeNull();
  });

  it('permits closing historical terms after a site is archived without allowing new assignments', async () => {
    const original = await createEmploymentContract(context(), { terms: terms(), reason });
    sqlite().exec("UPDATE sites SET is_active = 0 WHERE id = 'site-a'");
    const ended = await endEmploymentContract(context(), {
      ...target(original),
      effectiveUntil: '2026-06-01',
    });
    await expect(
      createEmploymentContract(context(), {
        terms: { ...terms(), effectiveFrom: '2026-07-01' },
        reason,
      })
    ).rejects.toMatchObject({ reason: 'not_found' });
    await voidEmploymentContract(context(), target(ended));
    expect(events().map(e => e.kind)).toEqual(['created', 'ended', 'voided']);
  });

  it('rechecks tenant deactivation inside every write, including void', async () => {
    const original = await createEmploymentContract(context(), { terms: terms(), reason });
    const pending = voidEmploymentContract(context(), target(original));
    sqlite().exec("UPDATE tenants SET is_active = 0 WHERE id = 'a'");
    await expect(pending).rejects.toMatchObject({ reason: 'not_found' });
    expect(events()).toHaveLength(1);
    expect(rows()[0]!.voidedAt).toBeNull();
  });

  it.each(['manager', 'cashier', 'viewer'] as const)(
    'rejects %s without reading or writing salary evidence',
    async role => {
      await expect(
        createEmploymentContract(context({ user: { ...context().user, role } }), {
          terms: terms(),
          reason,
        })
      ).rejects.toMatchObject({ reason: 'forbidden' });
      expect(rows()).toEqual([]);
    }
  );

  it('rechecks an administrator demoted before writer acquisition', async () => {
    const pending = createEmploymentContract(context(), { terms: terms(), reason });
    getDatabase().update(users).set({ role: 'manager' }).where(eq(users.id, 'admin')).run();
    await expect(pending).rejects.toMatchObject({ reason: 'forbidden' });
    expect(rows()).toEqual([]);
  });

  it.each([{ userId: 'foreign' }, { siteId: 'site-b' }, { userId: 'missing' }])(
    'rejects unavailable employee/site %o',
    async patch => {
      await expect(
        createEmploymentContract(context(), { terms: { ...terms(), ...patch }, reason })
      ).rejects.toMatchObject({ reason: 'not_found' });
      expect(rows()).toEqual([]);
    }
  );

  it('rejects foreign contract targets and target-site substitution', async () => {
    const original = await createEmploymentContract(context(), { terms: terms(), reason });
    const foreign = context({
      tenantId: 'b',
      user: { ...context().user, id: 'foreign', tenantId: 'b' },
    });
    await expect(
      voidEmploymentContract(foreign, { ...target(original), siteId: 'site-b' })
    ).rejects.toMatchObject({ reason: 'not_found' });
    await expect(
      voidEmploymentContract(context(), { ...target(original), siteId: 'site-a2' })
    ).rejects.toMatchObject({ reason: 'not_found' });
    expect(events()).toHaveLength(1);
  });

  it('rejects mismatched currency rather than inferring exchange rates', async () => {
    await expect(
      createEmploymentContract(context(), { terms: { ...terms(), currencyCode: 'USD' }, reason })
    ).rejects.toMatchObject({ reason: 'currency' });
    expect(rows()).toEqual([]);
  });

  it.each([
    { effectiveFrom: '2026-01-01' },
    { effectiveFrom: '2027-01-01' },
    { effectiveUntil: null },
    { userId: 'admin' },
  ])('does not silently extend, reassign, or empty a replacement window %o', async patch => {
    const original = await createEmploymentContract(context(), {
      terms: { ...terms(), effectiveUntil: '2027-01-01' },
      reason,
    });
    await expect(
      replaceEmploymentContract(context(), {
        ...target(original),
        terms: { ...terms(), effectiveFrom: '2026-07-01', effectiveUntil: '2027-01-01', ...patch },
      })
    ).rejects.toThrow();
    expect(rows()).toHaveLength(1);
    expect(events()).toHaveLength(1);
  });

  it.each([
    ['pay_amount', -1],
    ['pay_amount', 1.005],
    ['pay_amount', 1e13],
    ['effective_from', '2026-02-30'],
    ['effective_from', 'not-a-date'],
    ['effective_from', '0000-01-01'],
    ['effective_until', '2026-02-30'],
    ['effective_until', '2025-01-01'],
    ['costing_hourly_rate', 10],
    ['pay_basis', 'unknown'],
    ['version', 1.5],
  ])('enforces raw SQLite %s=%s without relying on Zod', async (column, value) => {
    const original = await createEmploymentContract(context(), { terms: terms(), reason });
    // The column names are a closed fixture list, never operator input.
    expect(() =>
      sqlite()
        .prepare(`UPDATE employment_contracts SET ${column} = ? WHERE id = ?`)
        .run(value, original.id)
    ).toThrow();
    expect(rows()[0]).toMatchObject({
      version: 1,
      payAmount: 31111.11,
      effectiveFrom: '2026-01-01',
    });
  });
});
