/** Real tRPC command envelopes, private projections and employment-ledger isolation. */
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  devices,
  employmentContracts,
  employmentContractEvents,
  idempotencyKeys,
  operationEvents,
  syncOutbox,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import {
  createCriticalCommandFixture,
  freshCriticalContext,
} from './utils/criticalCommandFixture.js';
import type { Context } from '../trpc/context.js';
import * as commands from '../application/workforce/contracts.js';
import { isRemoteSyncApplyBlocked, resolveSyncTransportPolicy } from '../services/sync/contract.js';

let server: PuntovivoServer;
let deviceId: string;
function sqlite() {
  return (getDatabase() as unknown as { $client: Database.Database }).$client;
}
function context(overrides: Partial<Context> = {}) {
  return {
    ...freshCriticalContext({
      db: getDatabase(),
      serverApp: server.app,
      tenantId: 'tenant',
      userId: 'admin',
      email: 'admin@example.test',
      role: 'admin',
      siteId: 'site',
      deviceId,
      sessionVersion: 1,
    }),
    ...overrides,
  };
}
function caller(ctx = context()) {
  return appRouter.createCaller(ctx);
}
function input(userId = 'worker') {
  return {
    terms: {
      userId,
      siteId: 'site',
      position: 'Private position',
      effectiveFrom: '2026-01-01',
      currencyCode: 'COP',
      pay: { basis: 'hourly' as const, amount: 31987.65 },
    },
    reason: 'Confidential employment explanation',
  };
}
function target(row: { id: string; siteId: string; version: number }) {
  return { id: row.id, siteId: row.siteId, expectedVersion: row.version, reason: input().reason };
}
function evidence() {
  const db = getDatabase();
  return {
    contracts: db.select().from(employmentContracts).all(),
    events: db.select().from(employmentContractEvents).all(),
    audit: db.select().from(auditLogs).all(),
    outbox: db.select().from(syncOutbox).all(),
  };
}

beforeEach(async () => {
  server = await createServer({ dbPath: ':memory:', seedData: false, verbose: false });
  sqlite().exec(`
    INSERT INTO tenants(id,name,slug,default_currency_code) VALUES ('tenant','Tenant','tenant','COP'),('foreign','Foreign','foreign','COP');
    INSERT INTO companies(id,tenant_id,name) VALUES ('company','tenant','Company'),('foreign-company','foreign','Foreign');
    INSERT INTO sites(id,tenant_id,company_id,name) VALUES ('site','tenant','company','Central'),('site-two','tenant','company','Second'),('foreign-site','foreign','foreign-company','Foreign');
    INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES
      ('admin','tenant','Admin','admin@example.test','unused','admin'),
      ('worker','tenant','Worker','worker@example.test','unused','cashier'),
      ('manager','tenant','Manager','manager@example.test','unused','manager'),
      ('viewer','tenant','Viewer','viewer@example.test','unused','viewer'),
      ('foreign-user','foreign','Foreign','foreign@example.test','unused','admin');
    INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES ('tenant','CO'),('foreign','CO');
  `);
  deviceId = (
    await createCriticalCommandFixture({
      db: getDatabase(),
      serverApp: server.app,
      tenantId: 'tenant',
      userId: 'admin',
      email: 'admin@example.test',
      role: 'admin',
      siteId: 'site',
      sessionVersion: 1,
    })
  ).deviceId;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

describe('workforce contracts transport', () => {
  it('returns only authoritative tenant currency and timezone for administrator forms', async () => {
    expect(await caller().workforce.contracts.context()).toEqual({
      currencyCode: 'COP',
      timeZone: 'America/Bogota',
    });
    sqlite()
      .prepare('UPDATE tenants SET default_currency_code = ? WHERE id = ?')
      .run('USD', 'tenant');
    expect((await caller().workforce.contracts.context()).currencyCode).toBe('USD');
    const ctx = context();
    await expect(
      caller({ ...ctx, user: { ...ctx.user!, role: 'manager' } }).workforce.contracts.context()
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const foreign = caller({
      ...ctx,
      tenantId: 'foreign',
      user: { ...ctx.user!, id: 'foreign-user', tenantId: 'foreign' },
    });
    expect((await foreign.workforce.contracts.context()).currencyCode).toBe('COP');
  });
  it('requires a registered command envelope before any salary write', async () => {
    const ctx = context();
    delete ctx.req.headers['x-puntovivo-envelope'];
    await expect(caller(ctx).workforce.contracts.create(input())).rejects.toMatchObject({
      cause: { errorCode: 'MISSING_COMMAND_ENVELOPE' },
    });
    expect(evidence().contracts).toEqual([]);
  });

  it('replays each lifecycle command once with private events, audit and terminal local outbox', async () => {
    const create = caller();
    const original = await create.workforce.contracts.create(input());
    expect(await create.workforce.contracts.create(input())).toEqual(original);
    const replace = caller(),
      replacementInput = {
        ...target(original),
        terms: {
          ...input().terms,
          effectiveFrom: '2026-07-01',
          pay: { basis: 'hourly' as const, amount: 35000 },
        },
      };
    const replacement = await replace.workforce.contracts.replace(replacementInput);
    expect(await replace.workforce.contracts.replace(replacementInput)).toEqual(replacement);
    const end = caller(),
      endInput = { ...target(replacement), effectiveUntil: '2027-01-01' };
    const ended = await end.workforce.contracts.end(endInput);
    expect(await end.workforce.contracts.end(endInput)).toEqual(ended);
    const voidCommand = caller(),
      voidInput = target(ended);
    const voided = await voidCommand.workforce.contracts.void(voidInput);
    expect(await voidCommand.workforce.contracts.void(voidInput)).toEqual(voided);
    const current = evidence();
    expect(current.contracts).toHaveLength(2);
    expect(current.events).toHaveLength(5);
    expect(current.audit).toHaveLength(5);
    expect(current.outbox).toHaveLength(5);
    expect(
      current.outbox.every(row => row.status === 'local_only' && row.conflictPolicy === 'manual')
    ).toBe(true);
    expect(
      current.events.filter(row => row.contractId === replacement.id).map(row => row.kind)
    ).toEqual(['created', 'ended', 'voided']);
    expect(getDatabase().select().from(idempotencyKeys).all()).toHaveLength(4);
    expect(
      getDatabase()
        .select()
        .from(idempotencyKeys)
        .all()
        .every(row => row.status === 'succeeded')
    ).toBe(true);
    const journal = getDatabase().select().from(operationEvents).all();
    expect(journal).toHaveLength(4);
    expect(journal.every(row => row.status === 'succeeded')).toBe(true);
    // The authoritative in-transaction outbox links the best-effort operation
    // journal directly; it does not insert the asynchronous effects projection.
    for (const row of current.outbox)
      expect(journal.map(event => event.id)).toContain(row.operationEventId);
    const generic = JSON.stringify({
      audit: current.audit,
      outbox: current.outbox,
      keys: getDatabase().select().from(idempotencyKeys).all(),
      journal: getDatabase().select().from(operationEvents).all(),
    });
    for (const secret of [
      '31987.65',
      '35000',
      input().reason,
      input().terms.position,
      'payAmount',
      'costingHourlyRate',
    ])
      expect(generic).not.toContain(secret);
    expect(resolveSyncTransportPolicy('employment_contracts')).toBe('local_only');
    expect(isRemoteSyncApplyBlocked('employment_contracts')).toBe(true);
  });

  it('rejects a changed salary under a replay key rather than mutating compensation twice', async () => {
    const api = caller();
    await api.workforce.contracts.create(input());
    await expect(
      api.workforce.contracts.create({
        ...input(),
        terms: { ...input().terms, pay: { basis: 'hourly', amount: 1 } },
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'IDEMPOTENCY_KEY_CONFLICT' } });
    expect(evidence().events).toHaveLength(1);
  });

  it.each(['manager', 'cashier', 'viewer'] as const)(
    'blocks %s before returning an administrators cached command or private reads',
    async role => {
      const ctx = context();
      const original = await caller(ctx).workforce.contracts.create(input());
      const denied = caller({ ...ctx, user: { ...ctx.user!, role } });
      await expect(denied.workforce.contracts.create(input())).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(denied.workforce.contracts.list({})).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(denied.workforce.contracts.get(original)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(denied.workforce.contracts.events(original)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(evidence().events).toHaveLength(1);
    }
  );

  it('rejects an old admin identity after a real role revocation', async () => {
    const ctx = context();
    await caller(ctx).workforce.contracts.create(input());
    getDatabase()
      .update(users)
      .set({ role: 'manager', sessionVersion: 2 })
      .where(eq(users.id, 'admin'))
      .run();
    await expect(caller(ctx).workforce.contracts.create(input())).rejects.toMatchObject({
      cause: { errorCode: 'AUTH_IDENTITY_CHANGED' },
    });
    expect(evidence().events).toHaveLength(1);
  });

  it('provides manager job assignments without compensation, private history, or administrator jobs', async () => {
    await caller().workforce.contracts.create(input());
    await caller().workforce.contracts.create(input('admin'));
    await caller().workforce.contracts.create(input('viewer'));
    const ctx = context(),
      manager = caller({ ...ctx, user: { ...ctx.user!, id: 'manager', role: 'manager' } });
    const page = await manager.workforce.assignments({ onDate: '2026-01-01' });
    expect(page.items.map(row => row.userId).sort()).toEqual(['viewer', 'worker']);
    const serialized = JSON.stringify(page);
    for (const forbidden of [
      'payAmount',
      'payBasis',
      'costingHourlyRate',
      'currencyCode',
      input().reason,
      '31987.65',
      'createdByUserId',
    ])
      expect(serialized).not.toContain(forbidden);
    expect((await manager.workforce.assignments({ userId: 'admin' })).items).toEqual([]);
    for (const role of ['cashier', 'viewer'] as const)
      await expect(
        caller({ ...ctx, user: { ...ctx.user!, role } }).workforce.assignments({})
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('paginates same-date contracts and private event versions without duplicates', async () => {
    for (const userId of ['worker', 'viewer', 'manager'])
      await caller().workforce.contracts.create(input(userId));
    const first = await caller().workforce.contracts.list({ limit: 1 });
    const second = await caller().workforce.contracts.list({ limit: 1, cursor: first.nextCursor! });
    const third = await caller().workforce.contracts.list({ limit: 1, cursor: second.nextCursor! });
    expect(new Set([...first.items, ...second.items, ...third.items].map(row => row.id)).size).toBe(
      3
    );
    expect(third.nextCursor).toBeNull();
    const original = first.items[0]!;
    const ended = await caller().workforce.contracts.end({
      ...target(original),
      effectiveUntil: '2026-07-01',
    });
    await caller().workforce.contracts.void(target(ended));
    const latest = await caller().workforce.contracts.events({
      id: original.id,
      siteId: original.siteId,
      limit: 1,
    });
    const previous = await caller().workforce.contracts.events({
      id: original.id,
      siteId: original.siteId,
      limit: 1,
      beforeVersion: latest.nextBeforeVersion!,
    });
    expect(latest.items[0]!.kind).toBe('voided');
    expect(previous.items[0]!.kind).toBe('ended');
    expect((await caller().workforce.contracts.list({})).items).toHaveLength(2);
    expect((await caller().workforce.contracts.list({ includeVoided: true })).items).toHaveLength(
      3
    );
  });

  it('uses half-open effective dates and excludes voided terms from manager assignments', async () => {
    const original = await caller().workforce.contracts.create({
      ...input(),
      terms: { ...input().terms, effectiveUntil: '2026-02-01' },
    });
    expect((await caller().workforce.assignments({ onDate: '2026-01-31' })).items).toHaveLength(1);
    expect((await caller().workforce.assignments({ onDate: '2026-02-01' })).items).toEqual([]);
    await caller().workforce.contracts.void(target(original));
    expect((await caller().workforce.assignments({ onDate: '2026-01-31' })).items).toEqual([]);
  });

  it('rejects foreign sites on every read and write path', async () => {
    const original = await caller().workforce.contracts.create(input());
    const api = caller();
    for (const operation of [
      () => api.workforce.assignments({ siteId: 'foreign-site' }),
      () => api.workforce.contracts.list({ siteId: 'foreign-site' }),
      () => api.workforce.contracts.get({ id: original.id, siteId: 'foreign-site' }),
      () => api.workforce.contracts.events({ id: original.id, siteId: 'foreign-site' }),
      () =>
        api.workforce.contracts.create({
          ...input(),
          terms: { ...input().terms, siteId: 'foreign-site' },
        }),
      () =>
        api.workforce.contracts.end({
          ...target(original),
          siteId: 'foreign-site',
          effectiveUntil: '2026-03-01',
        }),
      () =>
        api.workforce.contracts.replace({
          ...target(original),
          terms: { ...input().terms, siteId: 'foreign-site', effectiveFrom: '2026-03-01' },
        }),
      () => api.workforce.contracts.void({ ...target(original), siteId: 'foreign-site' }),
    ])
      await expect(operation()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(evidence().contracts).toHaveLength(1);
    expect(evidence().events).toHaveLength(1);
  });

  it('returns no foreign employee data, including filtered manager/admin projections', async () => {
    const original = await caller().workforce.contracts.create(input());
    const ctx = context(),
      foreign = caller({
        ...ctx,
        tenantId: 'foreign',
        user: { ...ctx.user!, id: 'foreign-user', tenantId: 'foreign' },
      });
    expect((await foreign.workforce.assignments({ userId: 'worker' })).items).toEqual([]);
    expect(
      (await foreign.workforce.contracts.list({ userId: 'worker', includeVoided: true })).items
    ).toEqual([]);
    await expect(
      foreign.workforce.contracts.get({ id: original.id, siteId: 'foreign-site' })
    ).rejects.toMatchObject({ cause: { errorCode: 'EMPLOYMENT_CONTRACT_NOT_FOUND' } });
    await expect(caller().workforce.contracts.create(input('foreign-user'))).rejects.toMatchObject({
      cause: { errorCode: 'EMPLOYMENT_CONTRACT_NOT_FOUND' },
    });
  });

  it('sanitizes reservation failures before the resolver and permits the same command to retry', async () => {
    const ctx = context();
    sqlite().exec(
      "CREATE TRIGGER reject_employment_reservation BEFORE INSERT ON idempotency_keys BEGIN SELECT RAISE(ABORT, 'PRIVATE_COMMAND_STORAGE_DETAIL'); END"
    );
    await expect(caller(ctx).workforce.contracts.create(input())).rejects.toMatchObject({
      cause: { errorCode: 'EMPLOYMENT_CONTRACT_TEMPORARILY_UNAVAILABLE' },
      message: 'Employment records are temporarily unavailable; retry the same operation',
    });
    expect(evidence()).toEqual({ contracts: [], events: [], audit: [], outbox: [] });
    expect(getDatabase().select().from(idempotencyKeys).all()).toEqual([]);
    sqlite().exec('DROP TRIGGER reject_employment_reservation');
    const api = caller(ctx);
    const result = await api.workforce.contracts.create(input());
    expect(await api.workforce.contracts.create(input())).toEqual(result);
    expect(evidence().events).toHaveLength(1);
  });

  it('rolls back salary, event, audit and outbox if actual command completion cannot persist', async () => {
    const ctx = context();
    sqlite().exec(
      "CREATE TRIGGER reject_employment_completion BEFORE UPDATE ON idempotency_keys WHEN NEW.status = 'succeeded' BEGIN SELECT RAISE(ABORT, 'Private SQLite failure'); END"
    );
    await expect(caller(ctx).workforce.contracts.create(input())).rejects.toMatchObject({
      cause: { errorCode: 'EMPLOYMENT_CONTRACT_TEMPORARILY_UNAVAILABLE' },
      message: 'Employment records are temporarily unavailable; retry the same operation',
    });
    expect(evidence()).toEqual({ contracts: [], events: [], audit: [], outbox: [] });
    expect(getDatabase().select().from(idempotencyKeys).all()[0]!.status).toBe('failed');
    sqlite().exec('DROP TRIGGER reject_employment_completion');
    await caller(ctx).workforce.contracts.create(input());
    expect(evidence().events).toHaveLength(1);
  });

  it('recovers the durable result after a resolver fault following commit without executing twice', async () => {
    const original = commands.createEmploymentContract;
    const fault = vi
      .spyOn(commands, 'createEmploymentContract')
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('Private post-commit fault');
      });
    const api = caller();
    const result = await api.workforce.contracts.create(input());
    expect(await api.workforce.contracts.create(input())).toEqual(result);
    expect(fault).toHaveBeenCalledOnce();
    expect(evidence().events).toHaveLength(1);
    expect(evidence().outbox).toHaveLength(1);
  });

  it('serializes two devices competing for overlapping employment dates', async () => {
    const second = await createCriticalCommandFixture({
      db: getDatabase(),
      serverApp: server.app,
      tenantId: 'tenant',
      userId: 'admin',
      email: 'admin@example.test',
      role: 'admin',
      siteId: 'site-two',
      sessionVersion: 1,
    });
    const results = await Promise.allSettled([
      caller().workforce.contracts.create(input()),
      caller(second.context).workforce.contracts.create({
        ...input(),
        terms: { ...input().terms, siteId: 'site-two' },
      }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({
      reason: { cause: { errorCode: 'EMPLOYMENT_CONTRACT_OVERLAP' } },
    });
    expect(evidence().contracts).toHaveLength(1);
    expect(evidence().events).toHaveLength(1);
  });

  it('does not disclose a private result after device revocation', async () => {
    const ctx = context();
    await caller(ctx).workforce.contracts.create(input());
    getDatabase().update(devices).set({ isActive: false }).where(eq(devices.id, deviceId)).run();
    await expect(caller(ctx).workforce.contracts.create(input())).rejects.toThrow();
    expect(evidence().events).toHaveLength(1);
  });

  it('bounds read pages and rejects role injection in strict compensation inputs', async () => {
    await expect(caller().workforce.contracts.list({ limit: 101 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller().workforce.assignments({ onDate: '2026-02-30' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller().workforce.contracts.create({
        ...input(),
        terms: { ...input().terms, role: 'admin' },
      } as never)
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(evidence().contracts).toEqual([]);
  });

  it('maps currency, stale version and invalid state to stable safe errors', async () => {
    await expect(
      caller().workforce.contracts.create({
        ...input(),
        terms: { ...input().terms, currencyCode: 'USD' },
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'EMPLOYMENT_CONTRACT_CURRENCY_MISMATCH' } });
    const original = await caller().workforce.contracts.create(input());
    await expect(
      caller().workforce.contracts.end({
        ...target(original),
        expectedVersion: 2,
        effectiveUntil: '2026-02-01',
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'STALE_VERSION' } });
    await expect(
      caller().workforce.contracts.end({ ...target(original), effectiveUntil: '2025-01-01' })
    ).rejects.toMatchObject({ cause: { errorCode: 'EMPLOYMENT_CONTRACT_STATE_INVALID' } });
  });
});
