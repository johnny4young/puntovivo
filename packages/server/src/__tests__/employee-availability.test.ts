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
import * as commands from '../application/workforce/availability.js';
import * as conflicts from '../services/labor/availability-conflicts.js';
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
const caller = (actor: keyof typeof actors = 'manager') => root(actor).workforce.availability;
const input = () => ({
  userId: 'worker',
  fromDate: '2026-09-07',
  untilDate: null,
  slots: [{ weekday: 1, startMinute: 480, endMinute: 960 }],
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
    rows: sqlite().prepare('SELECT * FROM employee_availability ORDER BY id').all(),
    events: sqlite().prepare('SELECT * FROM employee_availability_events ORDER BY id').all(),
    audit: sqlite()
      .prepare("SELECT * FROM audit_logs WHERE resource_type='availability' ORDER BY id")
      .all(),
    outbox: sqlite()
      .prepare("SELECT * FROM sync_outbox WHERE entity_type='employee_availability' ORDER BY id")
      .all(),
  };
}
beforeEach(async ({ task }) => {
  directory = task.name.includes('SQLITE_BUSY')
    ? mkdtempSync(join(tmpdir(), 'puntovivo-availability-'))
    : undefined;
  server = await createServer({
    dbPath: directory ? join(directory, 'availability.db') : ':memory:',
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

describe('effective availability commands', () => {
  it('rejects raw rewrites and deletion of private availability evidence', async () => {
    const row = await caller().create(input());
    expect(() =>
      sqlite().exec("UPDATE employee_availability_events SET reason='Attempted evidence rewrite'")
    ).toThrow(/AVAILABILITY_EVENT_IMMUTABLE/);
    expect(() => sqlite().exec('DELETE FROM employee_availability_events')).toThrow(
      /AVAILABILITY_EVENT_IMMUTABLE/
    );
    expect((await caller().events({ id: row.id })).items).toHaveLength(1);
  });

  it('creates, splits and voids with exact replay, immutable history and private transports', async () => {
    const api = caller(),
      row = await api.create(input());
    expect(await api.create(input())).toEqual(row);
    const original = state().events[0];
    const replace = caller(),
      replacement = {
        id: row.id,
        expectedVersion: 1,
        fromDate: '2026-09-14',
        slots: [{ weekday: 2, startMinute: 480, endMinute: 960 }],
        reason: input().reason,
      };
    const next = await replace.replace(replacement);
    expect(await replace.replace(replacement)).toEqual(next);
    expect(await caller().get({ id: row.id })).toMatchObject({
      untilDate: '2026-09-14',
      version: 2,
    });
    expect(await caller().get({ id: next.id })).toMatchObject({
      fromDate: '2026-09-14',
      untilDate: null,
      replacesId: row.id,
      version: 1,
    });
    expect(state().events).toContainEqual(original);
    const voidApi = caller(),
      target = { id: next.id, expectedVersion: 1, reason: input().reason };
    const voided = await voidApi.void(target);
    expect(await voidApi.void(target)).toEqual(voided);
    expect(voided).toMatchObject({ status: 'voided', version: 2 });
    expect(state().rows).toHaveLength(2);
    for (const key of ['events', 'audit', 'outbox'] as const) expect(state()[key]).toHaveLength(4);
    const history = await caller().events({ id: row.id, limit: 1 });
    expect(history.items[0]?.kind).toBe('ended');
    expect(history.nextBeforeVersion).toBe(2);
    expect(
      (await caller().events({ id: row.id, beforeVersion: 2 })).items[0]?.after.untilDate
    ).toBeNull();
    const generic = JSON.stringify({
      audit: state().audit,
      outbox: state().outbox,
      journal: sqlite().prepare('SELECT * FROM operation_events').all(),
      completion: sqlite().prepare('SELECT result_ref FROM idempotency_keys').all(),
    });
    for (const secret of [
      input().reason,
      input().fromDate,
      'startMinute',
      'slots',
      'America/Bogota',
    ])
      expect(generic).not.toContain(secret);
    expect(state().outbox.every(row => (row as { status: string }).status === 'local_only')).toBe(
      true
    );
    expect(isRemoteSyncApplyBlocked('employee_availability')).toBe(true);
    expect(resolveSyncTransportPolicy('employee_availability')).toBe('local_only');
    await expect(caller().void({ ...target, expectedVersion: 2 })).rejects.toMatchObject({
      cause: { errorCode: 'AVAILABILITY_STATE_INVALID' },
    });
    await expect(caller().replace(replacement)).rejects.toMatchObject({
      cause: { errorCode: 'STALE_VERSION' },
    });
  });
  it('preserves legacy scheduling but enforces every covered minute across sites', async () => {
    const legacy = await root().employeeShifts.schedule.create({
      ...shift(),
      startDate: '2026-09-01',
      endDate: '2026-09-01',
    });
    await caller().create(input());
    const row = await root().employeeShifts.schedule.create(shift());
    expect(row.siteId).toBe('second-site');
    await expect(
      root().employeeShifts.schedule.create({
        ...shift(),
        userId: 'worker',
        siteId: 'site',
        startDate: '2026-09-08',
        endDate: '2026-09-08',
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'SCHEDULE_AVAILABILITY_CONFLICT' } });
    await expect(
      root().employeeShifts.schedule.update({
        id: row.id,
        userId: 'worker',
        siteId: 'second-site',
        version: row.version,
        startDate: '2026-09-07',
        startTime: '08:00',
        endDate: '2026-09-07',
        endTime: '17:00',
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'SCHEDULE_AVAILABILITY_CONFLICT' } });
    expect(sqlite().prepare('SELECT count(*) n FROM scheduled_shifts').get()).toEqual({ n: 2 });
    expect(legacy.status).toBe('scheduled');
  });
  it('refuses incompatible new availability without changing existing shifts or actual attendance', async () => {
    await root().employeeShifts.schedule.create(shift());
    const before = sqlite().prepare('SELECT * FROM scheduled_shifts').all();
    await expect(caller().create({ ...input(), slots: [] })).rejects.toMatchObject({
      cause: { errorCode: 'AVAILABILITY_SCHEDULE_CONFLICT' },
    });
    expect(state().rows).toEqual([]);
    expect(sqlite().prepare('SELECT * FROM scheduled_shifts').all()).toEqual(before);
    expect(sqlite().prepare('SELECT count(*) n FROM employee_shifts').get()).toEqual({ n: 0 });
    await caller().create(input());
  });
  it('does not let availability bypass approved absence', async () => {
    const request = await root().workforce.timeOff.create({
      userId: 'worker',
      siteId: 'site',
      kind: 'leave',
      fromDate: '2026-09-07',
      untilDate: '2026-09-08',
      reason: input().reason,
    });
    await root().workforce.timeOff.advance({
      id: request.id,
      siteId: 'site',
      expectedVersion: 1,
      status: 'approved',
      reason: input().reason,
    });
    await caller().create(input());
    await expect(root().employeeShifts.schedule.create(shift())).rejects.toMatchObject({
      cause: { errorCode: 'SCHEDULE_TIME_OFF_CONFLICT' },
    });
  });
  it('rejects overlap, permits adjacent finite periods, and preserves old timezone on replacement', async () => {
    const first = await caller().create({ ...input(), untilDate: '2026-10-01' });
    await expect(caller().create(input())).rejects.toMatchObject({
      cause: { errorCode: 'AVAILABILITY_OVERLAP' },
    });
    sqlite().exec(
      "UPDATE tenant_locale_settings SET timezone_override='America/New_York',version=version+1 WHERE tenant_id='tenant'"
    );
    const next = await caller().replace({
      id: first.id,
      expectedVersion: 1,
      fromDate: '2026-09-14',
      slots: [],
      reason: input().reason,
    });
    expect(await caller().get({ id: next.id })).toMatchObject({
      timeZone: 'America/Bogota',
      untilDate: '2026-10-01',
    });
    // New York's earlier midnight would overlap the frozen Bogota ending: fail closed.
    await expect(caller().create({ ...input(), fromDate: '2026-10-01' })).rejects.toMatchObject({
      cause: { errorCode: 'AVAILABILITY_OVERLAP' },
    });
    await caller().create({ ...input(), fromDate: '2026-10-02' });
  });
  it.each(['2026-09-07', '2026-10-01', '2026-08-01'])(
    'rejects successor outside original open interval: %s',
    async fromDate => {
      const row = await caller().create({ ...input(), untilDate: '2026-10-01' });
      await expect(
        caller().replace({
          id: row.id,
          expectedVersion: 1,
          fromDate,
          slots: [],
          reason: input().reason,
        })
      ).rejects.toMatchObject({ cause: { errorCode: 'AVAILABILITY_WINDOW_INVALID' } });
      expect(state().rows).toHaveLength(1);
      expect(state().events).toHaveLength(1);
    }
  );
});

describe('availability access and bounded reads', () => {
  it.each(['worker', 'cashier'] as const)(
    'denies every management capability to %s',
    async actor => {
      const row = await caller().create(input()),
        api = caller(actor),
        target = { id: row.id, expectedVersion: 1, reason: input().reason };
      for (const action of [
        () => api.list({}),
        () => api.get({ id: row.id }),
        () => api.employees({}),
        () => api.events({ id: row.id }),
        () => api.create(input()),
        () => api.void(target),
        () => api.replace({ ...target, fromDate: '2026-09-14', slots: [] }),
      ])
        await expect(action()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  );
  it('isolates tenants and protects current administrator employees on reads and writes', async () => {
    const row = await caller().create(input());
    for (const action of [
      () => caller('foreign').get({ id: row.id }),
      () => caller('foreign').events({ id: row.id }),
      () => caller('foreign').void({ id: row.id, expectedVersion: 1, reason: input().reason }),
      () => caller().create({ ...input(), userId: 'foreign' }),
      () => caller().create({ ...input(), userId: 'admin' }),
    ])
      await expect(action()).rejects.toMatchObject({
        cause: { errorCode: 'AVAILABILITY_NOT_FOUND' },
      });
    expect((await caller('foreign').list({})).items).toEqual([]);
    sqlite().exec("UPDATE users SET role='admin' WHERE id='worker'");
    expect((await caller().list({})).items).toEqual([]);
    await expect(caller().events({ id: row.id })).rejects.toMatchObject({
      cause: { errorCode: 'AVAILABILITY_NOT_FOUND' },
    });
    expect((await caller('admin').get({ id: row.id })).id).toBe(row.id);
    expect((await caller().employees({})).items.map(row => row.id)).not.toContain('worker');
    await expect(root().users.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('allows explicit void after employee archival, but not replacement or a new policy', async () => {
    const row = await caller().create(input());
    sqlite().exec("UPDATE users SET is_active=0 WHERE id='worker'");
    await expect(
      caller().replace({
        id: row.id,
        expectedVersion: 1,
        fromDate: '2026-09-14',
        slots: [],
        reason: input().reason,
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'AVAILABILITY_NOT_FOUND' } });
    await caller().void({ id: row.id, expectedVersion: 1, reason: input().reason });
    await expect(caller().create(input())).rejects.toMatchObject({
      cause: { errorCode: 'AVAILABILITY_NOT_FOUND' },
    });
    expect((await caller().events({ id: row.id })).items).toHaveLength(2);
  });
  it('paginates tied timestamps deterministically and omits private reasons', async () => {
    const ids = [];
    for (const [fromDate, untilDate] of [
      ['2026-09-01', '2026-09-02'],
      ['2026-09-02', '2026-09-03'],
      ['2026-09-03', '2026-09-04'],
    ])
      ids.push(
        (await caller().create({ ...input(), fromDate: fromDate!, untilDate: untilDate! })).id
      );
    sqlite().exec("UPDATE employee_availability SET created_at='2026-01-01T00:00:00.000Z'");
    const page = await caller().list({ limit: 2 }),
      last = await caller().list({ limit: 2, cursor: page.nextCursor! });
    expect([...page.items, ...last.items].map(row => row.id)).toEqual(ids.sort().reverse());
    expect(last.nextCursor).toBeNull();
    expect(JSON.stringify(page)).not.toContain(input().reason);
    await caller().void({ id: ids[0]!, expectedVersion: 1, reason: input().reason });
    expect((await caller().list({})).items).toHaveLength(2);
    expect((await caller().list({ includeVoided: true })).items).toHaveLength(3);
    for (const op of [
      () => caller().list({ limit: 101 }),
      () => caller().events({ id: ids[0]!, limit: 101 }),
      () => caller().employees({ limit: 101 }),
    ])
      await expect(op()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('availability atomicity and concurrency', () => {
  it.each([
    ['reservation', 'BEFORE INSERT ON idempotency_keys'],
    ['policy', 'BEFORE INSERT ON employee_availability'],
    ['event', 'BEFORE INSERT ON employee_availability_events'],
    ['completion', "BEFORE UPDATE ON idempotency_keys WHEN NEW.status='succeeded'"],
    ['outbox', "BEFORE INSERT ON sync_outbox WHEN NEW.entity_type='employee_availability'"],
    ['audit', "BEFORE INSERT ON audit_logs WHEN NEW.resource_type='availability'"],
  ])('rolls back %s failure and retries the same envelope', async (_name, trigger) => {
    const api = caller();
    sqlite().exec(
      `CREATE TRIGGER fail_availability ${trigger} BEGIN SELECT RAISE(ABORT,'PRIVATE_SQL_DETAIL'); END`
    );
    await expect(api.create(input())).rejects.toMatchObject({
      cause: { errorCode: 'AVAILABILITY_TEMPORARILY_UNAVAILABLE' },
      message: 'Availability is temporarily unavailable; retry the same operation',
    });
    expect(state()).toEqual({ rows: [], events: [], audit: [], outbox: [] });
    sqlite().exec('DROP TRIGGER fail_availability');
    const result = await api.create(input());
    expect(await api.create(input())).toEqual(result);
    expect(state().events).toHaveLength(1);
  });
  it('rolls back both sides of replacement if inserting successor fails', async () => {
    const row = await caller().create(input()),
      before = state(),
      api = caller(),
      target = {
        id: row.id,
        expectedVersion: 1,
        fromDate: '2026-09-14',
        slots: [],
        reason: input().reason,
      };
    sqlite().exec(
      "CREATE TRIGGER fail_successor BEFORE INSERT ON employee_availability WHEN NEW.replaces_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'PRIVATE_FAIL'); END"
    );
    await expect(api.replace(target)).rejects.toMatchObject({
      cause: { errorCode: 'AVAILABILITY_TEMPORARILY_UNAVAILABLE' },
    });
    expect(state()).toEqual(before);
    sqlite().exec('DROP TRIGGER fail_successor');
    await api.replace(target);
    expect(state().rows).toHaveLength(2);
    expect(state().events).toHaveLength(3);
  });
  it.each(['create', 'replace', 'void'] as const)(
    'recovers %s after durable commit but lost response',
    async kind => {
      const api = caller();
      const row = kind === 'create' ? null : await caller().create(input());
      // Each branch preserves its exact command input type and returns through middleware recovery.
      if (kind === 'create')
        vi.spyOn(commands, 'createAvailability').mockImplementationOnce(async (...args) => {
          await commandsOriginalCreate(...args);
          throw new Error('PRIVATE_RESPONSE_LOSS');
        });
      else if (kind === 'replace')
        vi.spyOn(commands, 'replaceAvailability').mockImplementationOnce(async (...args) => {
          await commandsOriginalReplace(...args);
          throw new Error('PRIVATE_RESPONSE_LOSS');
        });
      else
        vi.spyOn(commands, 'voidAvailability').mockImplementationOnce(async (...args) => {
          await commandsOriginalVoid(...args);
          throw new Error('PRIVATE_RESPONSE_LOSS');
        });
      const invoke = () =>
        kind === 'create'
          ? api.create(input())
          : kind === 'replace'
            ? api.replace({
                id: row!.id,
                expectedVersion: 1,
                fromDate: '2026-09-14',
                slots: [],
                reason: input().reason,
              })
            : api.void({ id: row!.id, expectedVersion: 1, reason: input().reason });
      const result = await invoke();
      expect(await invoke()).toEqual(result);
      expect(state().events).toHaveLength(kind === 'create' ? 1 : kind === 'replace' ? 3 : 2);
    }
  );
  it('rechecks the exact scheduled row set after preflight without cancelling the new shift', async () => {
    const original = conflicts.preflightAvailability;
    vi.spyOn(conflicts, 'preflightAvailability').mockImplementationOnce(async (...args) => {
      const digest = await original(...args);
      await root().employeeShifts.schedule.create(shift());
      return digest;
    });
    await expect(caller().create(input())).rejects.toMatchObject({
      cause: { errorCode: 'AVAILABILITY_SCHEDULE_CHANGED' },
    });
    expect(state().rows).toEqual([]);
    expect(sqlite().prepare('SELECT count(*) n FROM scheduled_shifts').get()).toEqual({ n: 1 });
    await caller().create(input());
  });
  it('serializes two overlapping policies and two successor decisions', async () => {
    const created = await Promise.allSettled([
      caller().create(input()),
      caller('admin').create(input()),
    ]);
    expect(created.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const row = (await caller().list({})).items[0]!,
      target = {
        id: row.id,
        expectedVersion: 1,
        fromDate: '2026-09-14',
        slots: [],
        reason: input().reason,
      };
    const replaced = await Promise.allSettled([
      caller().replace(target),
      caller('admin').replace(target),
    ]);
    expect(replaced.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(state().rows).toHaveLength(2);
    expect(state().events).toHaveLength(3);
  });
  it('retries safely after SQLITE_BUSY from an independent writer', async () => {
    const competitor = new Database(join(directory!, 'availability.db')),
      previous = sqlite().pragma('busy_timeout', { simple: true }) as number,
      api = caller();
    try {
      sqlite().pragma('busy_timeout=1');
      competitor.exec('BEGIN IMMEDIATE');
      await expect(api.create(input())).rejects.toMatchObject({
        cause: { errorCode: 'COMMAND_DATABASE_BUSY' },
      });
      expect(state().rows).toEqual([]);
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
  it.each([
    ['actor role', "UPDATE users SET role='cashier' WHERE id='manager'", 'AUTH_IDENTITY_CHANGED'],
    ['actor active', "UPDATE users SET is_active=0 WHERE id='manager'", 'AUTH_IDENTITY_CHANGED'],
    ['tenant active', "UPDATE tenants SET is_active=0 WHERE id='tenant'", 'AUTH_IDENTITY_CHANGED'],
    ['worker role', "UPDATE users SET role='admin' WHERE id='worker'", 'AVAILABILITY_NOT_FOUND'],
    ['worker active', "UPDATE users SET is_active=0 WHERE id='worker'", 'AVAILABILITY_NOT_FOUND'],
    [
      'locale',
      "UPDATE tenant_locale_settings SET timezone_override='America/New_York',version=version+1 WHERE tenant_id='tenant'",
      'STALE_VERSION',
    ],
  ])('reauthorizes %s after asynchronous preflight', async (_name, sql, errorCode) => {
    const original = conflicts.preflightAvailability;
    vi.spyOn(conflicts, 'preflightAvailability').mockImplementationOnce(async (...args) => {
      const digest = await original(...args);
      sqlite().exec(sql!);
      return digest;
    });
    await expect(caller().create(input())).rejects.toMatchObject({ cause: { errorCode } });
    expect(state().rows).toEqual([]);
  });
  it('reauthorizes before replay and does not expose cached results after demotion', async () => {
    const api = caller();
    await api.create(input());
    sqlite().exec("UPDATE users SET role='cashier' WHERE id='manager'");
    await expect(api.create(input())).rejects.toMatchObject({
      cause: { errorCode: 'AUTH_IDENTITY_CHANGED' },
    });
    expect(state().events).toHaveLength(1);
  });
});

describe('availability bounded preflight evidence', () => {
  const seed = () => {
    const insert = sqlite().prepare(
      `INSERT INTO scheduled_shifts(id,tenant_id,user_id,site_id,starts_at,ends_at,time_zone,created_by_user_id,updated_by_user_id) VALUES (?, 'tenant','worker','second-site',?,?,'America/Bogota','manager','manager')`
    );
    sqlite().transaction(() => {
      for (let index = 0; index < 120; index++) {
        const date = new Date(Date.UTC(2027, 0, 1 + index)).toISOString().slice(0, 10);
        insert.run(
          `page-${String(index).padStart(4, '0')}`,
          `${date}T13:00:00.000Z`,
          `${date}T21:00:00.000Z`
        );
      }
    })();
  };
  const allWeek = () => ({
    ...input(),
    slots: Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      startMinute: 480,
      endMinute: 960,
    })),
  });
  it('uses bounded indexed keyset pages and yields while validating the entire history', async () => {
    seed();
    let active = true,
      ticks = 0;
    const heartbeat = () => {
      if (active) {
        ticks++;
        setImmediate(heartbeat);
      }
    };
    setImmediate(heartbeat);
    try {
      const started = performance.now();
      await caller().create(allWeek());
      expect(ticks).toBeGreaterThanOrEqual(120);
      expect(state().rows).toHaveLength(1);
      const plan = sqlite()
        .prepare(
          "EXPLAIN QUERY PLAN SELECT id,starts_at,ends_at,version FROM scheduled_shifts WHERE tenant_id=? AND user_id=? AND status='scheduled' AND ends_at>? AND id>? ORDER BY id LIMIT 50"
        )
        .all('tenant', 'worker', '2026-09-07T05:00:00.000Z', 'page-0049');
      expect(JSON.stringify(plan)).toContain('idx_scheduled_shifts_employee_status_id');
      expect(JSON.stringify(plan)).not.toContain('TEMP B-TREE');
      process.stdout.write(
        `availability-preflight ${JSON.stringify({
          rows: 120,
          elapsedMs: Number((performance.now() - started).toFixed(2)),
          eventLoopYields: ticks,
          plan,
        })}\n`
      );
    } finally {
      active = false;
    }
  });
  it('finds a conflict beyond the first two pages rather than qualifying only a prefix', async () => {
    seed();
    sqlite().exec(
      "UPDATE scheduled_shifts SET ends_at='2027-04-30T22:00:00.000Z' WHERE id='page-0119'"
    );
    await expect(caller().create(allWeek())).rejects.toMatchObject({
      cause: { errorCode: 'AVAILABILITY_SCHEDULE_CONFLICT' },
    });
    expect(state().rows).toEqual([]);
  });
  it.each([
    "DELETE FROM scheduled_shifts WHERE id='page-0000'",
    "UPDATE scheduled_shifts SET version=version+1 WHERE id='page-0000'",
    "UPDATE scheduled_shifts SET ends_at='2027-01-01T22:00:00.000Z' WHERE id='page-0000'",
  ])('rejects a changed page behind the cursor before writer commit: %s', async sql => {
    seed();
    const original = conflicts.preflightAvailability;
    vi.spyOn(conflicts, 'preflightAvailability').mockImplementationOnce(async (...args) => {
      const digest = await original(...args);
      sqlite().exec(sql);
      return digest;
    });
    await expect(caller().create(allWeek())).rejects.toMatchObject({
      cause: { errorCode: 'AVAILABILITY_SCHEDULE_CHANGED' },
    });
    expect(state().rows).toEqual([]);
  });
});
const commandsOriginalCreate = commands.createAvailability;
const commandsOriginalReplace = commands.replaceAvailability;
const commandsOriginalVoid = commands.voidAvailability;
