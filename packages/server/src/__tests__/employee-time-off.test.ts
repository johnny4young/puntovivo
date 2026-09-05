/** Real tenant-scoped commands, private evidence and reciprocal scheduling invariants. */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../db/index.js';
import { createServer, type PuntovivoServer } from '../index.js';
import { appRouter } from '../trpc/router.js';
import {
  createCriticalCommandFixture,
  freshCriticalContext,
} from './utils/criticalCommandFixture.js';
import * as commands from '../application/workforce/time-off.js';
import * as clock from '../services/pharmacy/business-clock.js';
import { isRemoteSyncApplyBlocked, resolveSyncTransportPolicy } from '../services/sync/contract.js';

let server: PuntovivoServer;
let directory: string | undefined;
const devices = new Map<string, string>();
const sqlite = () => (getDatabase() as unknown as { $client: Database.Database }).$client;
const actors = {
  admin: 'admin',
  manager: 'manager',
  worker: 'viewer',
  cashier: 'cashier',
  foreign: 'admin',
} as const;
const context = (actor: keyof typeof actors = 'manager') =>
  freshCriticalContext({
    db: getDatabase(),
    serverApp: server.app,
    tenantId: actor === 'foreign' ? 'other' : 'tenant',
    userId: actor,
    email: `${actor}@example.test`,
    role: actors[actor],
    siteId: actor === 'foreign' ? 'foreign-site' : 'site',
    deviceId: devices.get(actor)!,
    sessionVersion: 1,
  });
const root = (actor: keyof typeof actors = 'manager') => appRouter.createCaller(context(actor));
const caller = (actor: keyof typeof actors = 'manager') => root(actor).workforce.timeOff;
const input = () => ({
  userId: 'worker',
  siteId: 'site',
  kind: 'vacation' as const,
  fromDate: '2026-09-07',
  untilDate: '2026-09-09',
  reason: 'PRIVATE approved planning explanation',
});
const shift = () => ({
  userId: 'worker',
  siteId: 'second-site',
  startDate: '2026-09-07',
  startTime: '08:00',
  endDate: '2026-09-07',
  endTime: '16:00',
});
function state() {
  return {
    rows: sqlite().prepare('SELECT * FROM employee_time_off ORDER BY id').all(),
    events: sqlite().prepare('SELECT * FROM employee_time_off_events ORDER BY id').all(),
    audit: sqlite()
      .prepare("SELECT * FROM audit_logs WHERE resource_type='time_off' ORDER BY id")
      .all(),
    outbox: sqlite()
      .prepare("SELECT * FROM sync_outbox WHERE entity_type='employee_time_off' ORDER BY id")
      .all(),
  };
}
/** Use a fresh identity for every intended decision; the returned caller retains it for retries. */
async function prepare(kind: 'create' | 'approved' | 'rejected' | 'cancelled') {
  const api = caller();
  if (kind === 'create') return { invoke: () => api.create(input()) };
  const row = await caller().create(input());
  return {
    invoke: () =>
      api.advance({
        id: row.id,
        siteId: row.siteId,
        expectedVersion: row.version,
        status: kind,
        reason: input().reason,
      }),
  };
}
beforeEach(async ({ task }) => {
  directory = task.name.includes('SQLITE_BUSY')
    ? mkdtempSync(join(tmpdir(), 'puntovivo-time-off-'))
    : undefined;
  server = await createServer({
    dbPath: directory ? join(directory, 'time-off.db') : ':memory:',
    seedData: false,
    verbose: false,
  });
  sqlite().exec(`
    INSERT INTO tenants(id,name,slug,default_currency_code) VALUES ('tenant','Tenant','tenant','COP'),('other','Other','other','COP');
    INSERT INTO companies(id,tenant_id,name) VALUES ('company','tenant','Company'),('other-company','other','Other');
    INSERT INTO sites(id,tenant_id,company_id,name) VALUES ('site','tenant','company','Central'),('second-site','tenant','company','North'),('foreign-site','other','other-company','Foreign');
    INSERT INTO users(id,tenant_id,name,email,password_hash,role) VALUES
      ('admin','tenant','Admin','admin@example.test','unused','admin'),
      ('manager','tenant','Manager','manager@example.test','unused','manager'),
      ('worker','tenant','Worker','worker@example.test','unused','viewer'),
      ('cashier','tenant','Cashier','cashier@example.test','unused','cashier'),
      ('foreign','other','Foreign','foreign@example.test','unused','admin');
    INSERT INTO tenant_locale_settings(tenant_id,country_code) VALUES ('tenant','CO'),('other','CO');
  `);
  devices.clear();
  for (const actor of Object.keys(actors) as Array<keyof typeof actors>) {
    const { deviceId } = await createCriticalCommandFixture({
      db: getDatabase(),
      serverApp: server.app,
      tenantId: actor === 'foreign' ? 'other' : 'tenant',
      userId: actor,
      email: `${actor}@example.test`,
      role: actors[actor],
      siteId: actor === 'foreign' ? 'foreign-site' : 'site',
      sessionVersion: 1,
    });
    devices.set(actor, deviceId);
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('time-off operational lifecycle', () => {
  it('rejects raw rewrites and deletion of private time-off evidence', async () => {
    const row = await caller().create(input());
    expect(() =>
      sqlite().exec("UPDATE employee_time_off_events SET reason='Attempted evidence rewrite'")
    ).toThrow(/TIME_OFF_EVENT_IMMUTABLE/);
    expect(() => sqlite().exec('DELETE FROM employee_time_off_events')).toThrow(
      /TIME_OFF_EVENT_IMMUTABLE/
    );
    expect((await caller().events({ id: row.id, siteId: row.siteId })).items).toHaveLength(1);
  });

  it('freezes the window, approves and cancels with immutable private history and exact replay', async () => {
    const api = caller(),
      row = await api.create(input());
    expect(await api.create(input())).toEqual(row);
    const original = state().events[0];
    const approved = await caller().advance({
      id: row.id,
      siteId: row.siteId,
      expectedVersion: 1,
      status: 'approved',
      reason: 'Approved operational coverage',
    });
    const cancel = caller(),
      target = {
        id: row.id,
        siteId: row.siteId,
        expectedVersion: 2,
        status: 'cancelled' as const,
        reason: 'Cancelled by explicit decision',
      };
    const cancelled = await cancel.advance(target);
    expect(await cancel.advance(target)).toEqual(cancelled);
    expect(approved).toMatchObject({ version: 2, status: 'approved' });
    expect(cancelled).toMatchObject({ version: 3, status: 'cancelled' });
    expect(state().events).toContainEqual(original);
    const saved = sqlite().prepare('SELECT * FROM employee_time_off').get();
    expect(saved).toMatchObject({
      starts_at: '2026-09-07T05:00:00.000Z',
      ends_at: '2026-09-09T05:00:00.000Z',
      approved_by_user_id: 'manager',
      approved_at: expect.any(String),
    });
    const first = await caller().events({ id: row.id, siteId: row.siteId, limit: 2 });
    expect(first.items.map(event => event.kind)).toEqual(['cancelled', 'approved']);
    expect(first.nextBeforeVersion).toBe(2);
    const last = await caller().events({
      id: row.id,
      siteId: row.siteId,
      limit: 2,
      beforeVersion: first.nextBeforeVersion!,
    });
    expect(last.items.map(event => event.reason)).toEqual([input().reason]);
    expect(last.nextBeforeVersion).toBeNull();
    for (const key of ['audit', 'outbox'] as const) expect(state()[key]).toHaveLength(3);
    const generic = JSON.stringify({
      audit: state().audit,
      outbox: state().outbox,
      completion: sqlite().prepare('SELECT result_ref FROM idempotency_keys').all(),
      journal: sqlite().prepare('SELECT * FROM operation_events').all(),
    });
    for (const secret of [
      input().reason,
      input().fromDate,
      input().untilDate,
      'vacation',
      'Approved operational coverage',
    ])
      expect(generic).not.toContain(secret);
    expect(state().outbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'local_only', conflict_policy: 'manual' }),
      ])
    );
    expect(isRemoteSyncApplyBlocked('employee_time_off')).toBe(true);
    expect(resolveSyncTransportPolicy('employee_time_off')).toBe('local_only');
    await expect(caller().advance({ ...target, expectedVersion: 3 })).rejects.toMatchObject({
      cause: { errorCode: 'TIME_OFF_STATE_INVALID' },
    });
    await expect(caller().advance(target)).rejects.toMatchObject({
      cause: { errorCode: 'STALE_VERSION' },
    });
  });

  it.each(['admin', 'manager'] as const)(
    'requires another person to approve %s time off',
    async actor => {
      const row = await caller(actor).create({ ...input(), userId: actor });
      await expect(
        caller(actor).advance({
          id: row.id,
          siteId: row.siteId,
          expectedVersion: 1,
          status: 'approved',
          reason: input().reason,
        })
      ).rejects.toMatchObject({ cause: { errorCode: 'TIME_OFF_SELF_APPROVAL' } });
      expect(state().rows[0]).toMatchObject({ status: 'pending', version: 1 });
    }
  );

  it('keeps pending requests compatible with shifts, but requires explicit cancellation before approval', async () => {
    const row = await caller().create(input());
    const scheduled = await root().employeeShifts.schedule.create(shift());
    const target = {
      id: row.id,
      siteId: row.siteId,
      expectedVersion: 1,
      status: 'approved' as const,
      reason: input().reason,
    };
    await expect(caller().advance(target)).rejects.toMatchObject({
      cause: { errorCode: 'TIME_OFF_SCHEDULE_CONFLICT' },
    });
    expect(sqlite().prepare('SELECT status FROM scheduled_shifts').get()).toEqual({
      status: 'scheduled',
    });
    await root().employeeShifts.schedule.cancel({ id: scheduled.id, version: scheduled.version });
    await caller().advance(target);
    await expect(root().employeeShifts.schedule.create(shift())).rejects.toMatchObject({
      cause: { errorCode: 'SCHEDULE_TIME_OFF_CONFLICT' },
    });
    const adjacent = await root().employeeShifts.schedule.create({
      ...shift(),
      startDate: input().untilDate,
      endDate: input().untilDate,
      startTime: '00:00',
      endTime: '08:00',
    });
    await expect(
      root().employeeShifts.schedule.update({
        ...shift(),
        id: adjacent.id,
        version: adjacent.version,
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'SCHEDULE_TIME_OFF_CONFLICT' } });
    expect(
      sqlite().prepare('SELECT starts_at FROM scheduled_shifts WHERE id=?').get(adjacent.id)
    ).toEqual({ starts_at: '2026-09-09T05:00:00.000Z' });
    await caller().advance({ ...target, expectedVersion: 2, status: 'cancelled' });
    await root().employeeShifts.schedule.create(shift());
  });

  it('rejects overlapping requests across sites and accepts adjacent or rejected replacements', async () => {
    const row = await caller().create(input());
    await expect(caller().create({ ...input(), siteId: 'second-site' })).rejects.toMatchObject({
      cause: { errorCode: 'TIME_OFF_OVERLAP' },
    });
    await caller().create({
      ...input(),
      siteId: 'second-site',
      fromDate: input().untilDate,
      untilDate: '2026-09-10',
    });
    await caller().advance({
      id: row.id,
      siteId: row.siteId,
      expectedVersion: 1,
      status: 'rejected',
      reason: input().reason,
    });
    await caller().create(input());
    expect(state().rows).toHaveLength(3);
  });

  it('freezes the original timezone despite a later company timezone change', async () => {
    const row = await caller().create(input());
    sqlite().exec(
      "UPDATE tenant_locale_settings SET timezone_override='America/New_York',version=version+1 WHERE tenant_id='tenant'"
    );
    await caller().advance({
      id: row.id,
      siteId: row.siteId,
      expectedVersion: 1,
      status: 'approved',
      reason: input().reason,
    });
    expect(
      sqlite().prepare('SELECT time_zone,starts_at,ends_at FROM employee_time_off').get()
    ).toEqual({
      time_zone: 'America/Bogota',
      starts_at: '2026-09-07T05:00:00.000Z',
      ends_at: '2026-09-09T05:00:00.000Z',
    });
  });

  it('keeps history readable and cancellation possible after site and employee archival', async () => {
    const row = await caller().create(input());
    sqlite().exec(
      "UPDATE users SET is_active=0 WHERE id='worker'; UPDATE sites SET is_active=0 WHERE id='site'"
    );
    await expect(
      caller().advance({
        id: row.id,
        siteId: row.siteId,
        expectedVersion: 1,
        status: 'approved',
        reason: input().reason,
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'TIME_OFF_NOT_FOUND' } });
    await caller().advance({
      id: row.id,
      siteId: row.siteId,
      expectedVersion: 1,
      status: 'cancelled',
      reason: input().reason,
    });
    expect((await caller().get({ id: row.id, siteId: row.siteId })).status).toBe('cancelled');
    expect((await caller().events({ id: row.id, siteId: row.siteId })).items).toHaveLength(2);
  });
});

describe('time-off privacy and bounded reads', () => {
  it('offers minimal manager-safe employee pages without expanding administrator directory access', async () => {
    const first = await caller().employees({ limit: 2 });
    expect(first.items).toEqual([
      { id: 'cashier', name: 'Cashier', role: 'cashier' },
      { id: 'manager', name: 'Manager', role: 'manager' },
    ]);
    expect(first.nextCursor).toBe('manager');
    const last = await caller().employees({ limit: 2, cursor: first.nextCursor! });
    expect(last.items).toEqual([{ id: 'worker', name: 'Worker', role: 'viewer' }]);
    expect(last.nextCursor).toBeNull();
    expect((await caller('admin').employees({})).items.map(row => row.id)).toContain('admin');
    expect((await caller('foreign').employees({})).items.map(row => row.id)).toEqual(['foreign']);
    await expect(root().users.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    sqlite().exec("UPDATE users SET is_active=0 WHERE id='worker'");
    expect((await caller().employees({ search: 'Worker' })).items).toEqual([]);
  });
  it('searches employee names literally and rejects unbounded pages', async () => {
    sqlite().exec("UPDATE users SET name='Worker %_Exact' WHERE id='worker'");
    expect((await caller().employees({ search: '%_' })).items).toEqual([
      { id: 'worker', name: 'Worker %_Exact', role: 'viewer' },
    ]);
    expect((await caller().employees({ search: 'example.test' })).items).toEqual([]);
    await expect(caller().employees({ limit: 101 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller().employees({ search: 'x'.repeat(101) })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it.each(['worker', 'cashier'] as const)(
    'does not grant management capabilities to %s',
    async actor => {
      const row = await caller().create(input());
      const api = caller(actor);
      for (const operation of [
        () => api.list({}),
        () => api.employees({}),
        () => api.get({ id: row.id, siteId: row.siteId }),
        () => api.events({ id: row.id, siteId: row.siteId }),
        () => api.create(input()),
        () =>
          api.advance({
            id: row.id,
            siteId: row.siteId,
            expectedVersion: 1,
            status: 'approved',
            reason: input().reason,
          }),
      ])
        await expect(operation()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  );

  it('excludes other tenants, other-site addresses and current administrators on every read', async () => {
    const row = await caller().create(input());
    await expect(
      caller('foreign').get({ id: row.id, siteId: 'foreign-site' })
    ).rejects.toMatchObject({ cause: { errorCode: 'TIME_OFF_NOT_FOUND' } });
    await expect(
      caller('foreign').events({ id: row.id, siteId: 'foreign-site' })
    ).rejects.toMatchObject({ cause: { errorCode: 'TIME_OFF_NOT_FOUND' } });
    expect((await caller('foreign').list({})).items).toEqual([]);
    await expect(caller().get({ id: row.id, siteId: 'second-site' })).rejects.toMatchObject({
      cause: { errorCode: 'TIME_OFF_NOT_FOUND' },
    });
    await expect(caller().create({ ...input(), userId: 'foreign' })).rejects.toMatchObject({
      cause: { errorCode: 'TIME_OFF_NOT_FOUND' },
    });
    await expect(caller().create({ ...input(), siteId: 'foreign-site' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    sqlite().exec("UPDATE users SET role='admin' WHERE id='worker'");
    expect((await caller().list({})).items).toEqual([]);
    await expect(caller().get({ id: row.id, siteId: row.siteId })).rejects.toMatchObject({
      cause: { errorCode: 'TIME_OFF_NOT_FOUND' },
    });
    await expect(caller().events({ id: row.id, siteId: row.siteId })).rejects.toMatchObject({
      cause: { errorCode: 'TIME_OFF_NOT_FOUND' },
    });
    expect((await caller('admin').events({ id: row.id, siteId: row.siteId })).items).toHaveLength(
      1
    );
  });

  it('paginates deterministically even when timestamps tie and excludes private explanations from lists', async () => {
    const ids: string[] = [];
    for (const [fromDate, untilDate] of [
      ['2026-09-01', '2026-09-02'],
      ['2026-09-02', '2026-09-03'],
      ['2026-09-03', '2026-09-04'],
    ]) {
      const row = await caller().create({ ...input(), fromDate: fromDate!, untilDate: untilDate! });
      ids.push(row.id);
    }
    sqlite().exec("UPDATE employee_time_off SET created_at='2026-08-01T00:00:00.000Z'");
    const first = await caller().list({ siteId: 'site', limit: 2 });
    const last = await caller().list({ siteId: 'site', limit: 2, cursor: first.nextCursor! });
    expect([...first.items, ...last.items].map(row => row.id)).toEqual(ids.sort().reverse());
    expect(last.nextCursor).toBeNull();
    expect(JSON.stringify(first)).not.toContain(input().reason);
    expect(
      (await caller().list({ fromDate: '2026-09-02', untilDate: '2026-09-03' })).items.map(
        row => row.fromDate
      )
    ).toEqual(['2026-09-02']);
    expect((await caller().list({ siteId: 'second-site' })).items).toEqual([]);
    await expect(caller().list({ limit: 101 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller().list({ fromDate: '2026-01-01' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('reauthorizes before replay after the actor is demoted', async () => {
    const api = caller();
    await api.create(input());
    const before = state();
    sqlite().exec("UPDATE users SET role='cashier' WHERE id='manager'");
    await expect(api.create(input())).rejects.toMatchObject({
      cause: { errorCode: 'AUTH_IDENTITY_CHANGED' },
    });
    expect(state()).toEqual(before);
  });
});

describe('time-off crash and contention recovery', () => {
  it.each(['create', 'approved', 'rejected', 'cancelled'] as const)(
    'recovers %s exactly once after commit before response',
    async kind => {
      const command = await prepare(kind);
      const create = commands.createTimeOff,
        advance = commands.advanceTimeOff;
      const fault =
        kind === 'create'
          ? vi.spyOn(commands, 'createTimeOff').mockImplementationOnce(async (...args) => {
              await create(...args);
              throw new Error('PRIVATE_POST_COMMIT_FAULT');
            })
          : vi.spyOn(commands, 'advanceTimeOff').mockImplementationOnce(async (...args) => {
              await advance(...args);
              throw new Error('PRIVATE_POST_COMMIT_FAULT');
            });
      const row = await command.invoke();
      expect(await command.invoke()).toEqual(row);
      expect(fault).toHaveBeenCalledOnce();
      expect(state().rows).toHaveLength(1);
      expect(state().events).toHaveLength(kind === 'create' ? 1 : 2);
      expect(state().audit).toHaveLength(kind === 'create' ? 1 : 2);
      expect(state().outbox).toHaveLength(kind === 'create' ? 1 : 2);
    }
  );

  it.each([
    ['reservation', 'BEFORE INSERT ON idempotency_keys'],
    ['event', 'BEFORE INSERT ON employee_time_off_events'],
    ['completion', "BEFORE UPDATE ON idempotency_keys WHEN NEW.status='succeeded'"],
    ['outbox', "BEFORE INSERT ON sync_outbox WHEN NEW.entity_type='employee_time_off'"],
    ['audit', "BEFORE INSERT ON audit_logs WHEN NEW.resource_type='time_off'"],
  ])('rolls back %s storage failure and retries the same identity', async (_name, trigger) => {
    const command = await prepare('create');
    sqlite().exec(
      `CREATE TRIGGER fail_time_off ${trigger} BEGIN SELECT RAISE(ABORT,'PRIVATE_STORAGE_DETAIL'); END`
    );
    await expect(command.invoke()).rejects.toMatchObject({
      cause: { errorCode: 'TIME_OFF_TEMPORARILY_UNAVAILABLE' },
      message: 'Time-off records are temporarily unavailable; retry the same operation',
    });
    expect(state()).toEqual({ rows: [], events: [], audit: [], outbox: [] });
    sqlite().exec('DROP TRIGGER fail_time_off');
    const result = await command.invoke();
    expect(await command.invoke()).toEqual(result);
    expect(state().events).toHaveLength(1);
  });

  it.each(['approved', 'rejected', 'cancelled'] as const)(
    'rolls back %s when completion fails',
    async kind => {
      const command = await prepare(kind),
        before = state();
      sqlite().exec(
        "CREATE TRIGGER fail_time_off BEFORE UPDATE ON idempotency_keys WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'PRIVATE_COMPLETION'); END"
      );
      await expect(command.invoke()).rejects.toMatchObject({
        cause: { errorCode: 'TIME_OFF_TEMPORARILY_UNAVAILABLE' },
      });
      expect(state()).toEqual(before);
      sqlite().exec('DROP TRIGGER fail_time_off');
      await command.invoke();
      expect(state().events).toHaveLength(2);
    }
  );

  it('retries the same identity after SQLITE_BUSY with an independent writer', async () => {
    const competitor = new Database(join(directory!, 'time-off.db'));
    const previous = sqlite().pragma('busy_timeout', { simple: true }) as number;
    const api = caller();
    try {
      sqlite().pragma('busy_timeout=1');
      competitor.exec('BEGIN IMMEDIATE');
      await expect(api.create(input())).rejects.toMatchObject({
        cause: { errorCode: 'COMMAND_DATABASE_BUSY' },
      });
      expect(state()).toEqual({ rows: [], events: [], audit: [], outbox: [] });
      competitor.exec('ROLLBACK');
      const row = await api.create(input());
      expect(await api.create(input())).toEqual(row);
      expect(state().events).toHaveLength(1);
    } finally {
      if (competitor.inTransaction) competitor.exec('ROLLBACK');
      competitor.close();
      sqlite().pragma(`busy_timeout=${previous}`);
    }
  });

  it('admits only one overlapping creation and only one current-version decision', async () => {
    const creations = await Promise.allSettled([
      caller().create(input()),
      caller('admin').create(input()),
    ]);
    expect(creations.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    const row = (await caller().list({})).items[0]!;
    const target = {
      id: row.id,
      siteId: row.siteId,
      expectedVersion: row.version,
      reason: input().reason,
    };
    const decisions = await Promise.allSettled([
      caller().advance({ ...target, status: 'approved' }),
      caller('admin').advance({ ...target, status: 'rejected' }),
    ]);
    expect(decisions.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(state().events).toHaveLength(2);
    expect(state().rows[0]).toMatchObject({ version: 2 });
  });

  it('serializes competing schedule creation and time-off approval', async () => {
    const row = await caller().create(input());
    const outcomes = await Promise.allSettled([
      root().employeeShifts.schedule.create(shift()),
      caller().advance({
        id: row.id,
        siteId: row.siteId,
        expectedVersion: 1,
        status: 'approved',
        reason: input().reason,
      }),
    ]);
    expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    const approved = sqlite()
      .prepare("SELECT count(*) AS n FROM employee_time_off WHERE status='approved'")
      .get() as { n: number };
    const scheduled = sqlite()
      .prepare("SELECT count(*) AS n FROM scheduled_shifts WHERE status='scheduled'")
      .get() as { n: number };
    expect(approved.n + scheduled.n).toBe(1);
  });

  for (const kind of ['create', 'approved', 'cancelled'] as const) {
    it.each([
      ['actor role', "UPDATE users SET role='cashier' WHERE id='manager'", 'AUTH_IDENTITY_CHANGED'],
      ['actor active', "UPDATE users SET is_active=0 WHERE id='manager'", 'AUTH_IDENTITY_CHANGED'],
      [
        'tenant active',
        "UPDATE tenants SET is_active=0 WHERE id='tenant'",
        'AUTH_IDENTITY_CHANGED',
      ],
      ['worker promoted', "UPDATE users SET role='admin' WHERE id='worker'", 'TIME_OFF_NOT_FOUND'],
      [
        'locale',
        "UPDATE tenant_locale_settings SET timezone_override='America/New_York',version=version+1 WHERE tenant_id='tenant'",
        'STALE_VERSION',
      ],
      ...(kind === 'cancelled'
        ? []
        : [
            [
              'worker archived',
              "UPDATE users SET is_active=0 WHERE id='worker'",
              'TIME_OFF_NOT_FOUND',
            ],
            ['site archived', "UPDATE sites SET is_active=0 WHERE id='site'", 'TIME_OFF_NOT_FOUND'],
          ]),
    ])(`rechecks ${kind} %s under the writer before mutation`, async (_name, sql, errorCode) => {
      const command = await prepare(kind),
        before = state(),
        resolve = clock.resolveTenantBusinessClock;
      vi.spyOn(clock, 'resolveTenantBusinessClock').mockImplementationOnce(async (...args) => {
        const value = await resolve(...args);
        sqlite().exec(sql!);
        return value;
      });
      await expect(command.invoke()).rejects.toMatchObject({ cause: { errorCode } });
      expect(state()).toEqual(before);
    });
  }
});
